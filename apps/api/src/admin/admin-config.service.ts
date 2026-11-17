import { HttpStatus, Injectable } from '@nestjs/common';
import { craftReturns, createSeededRng, miniGameReturns, simulate } from '@spincards/game-core';
import {
  type AdminConfigDetail,
  type AdminConfigVersion,
  type AdminExperiment,
  type AdminMe,
  type ConfigDiffEntry,
  type ConfigIssue,
  type ConfigSimulationReport,
  ErrorCode,
  GameConfigSchema,
  type GameConfig,
  REGIONS,
} from '@spincards/shared';
import { AppError } from '../common/app-error.js';
import { GameConfigService, parseConfig } from '../game-config/game-config.service.js';
import { ConfigStatus, type GameConfigVersion, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { auditAdmin } from './admin-users.service.js';
import { diffConfig } from './config-diff.js';

/**
 * Spins per pack and scenario of the activation check. Big hits (a full duplicate is ×60 on its
 * own) make small samples noisy: at 50 000 a single one moved the RTP by 6–7 points (D-148).
 */
export const DEFAULT_SIM_SPINS = 300_000;
const SIM_SEED = 42;
const SIM_CARD_SHARE_BP = 3000;
/** D-169: 21 played with basic strategy; ±0.3 points of noise at this size. */
const SIM_BLACKJACK_ROUNDS = 200_000;
/** D-170: crafts per tier and currency in the craft check (the Mythic numbers make it noisy). */
const SIM_CRAFTS = 20_000;

/**
 * Config versions (TZ 15.2): drafts are validated against the schema, compared with the active
 * version, simulated (every enabled paid pack in every region it is sold in) and only a version
 * whose simulated RTP stays in the corridor can be activated. Rolling back re-activates an
 * archived version (it was active before). The active version applies to new spins within the
 * config cache delay; spins keep the version they were rolled with.
 */
@Injectable()
export class AdminConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
  ) {}

  async list(): Promise<AdminConfigVersion[]> {
    const rows = await this.prisma.gameConfigVersion.findMany({
      orderBy: { id: 'desc' },
      take: 100,
    });
    return rows.map(summary);
  }

  async get(id: number): Promise<AdminConfigDetail> {
    const row = await this.find(id);
    return {
      ...summary(row),
      payload: row.payload,
      simulation: (row.simulationReport as ConfigSimulationReport | null) ?? null,
    };
  }

  validate(payload: unknown): ConfigIssue[] {
    const result = GameConfigSchema.safeParse(payload);
    if (result.success) return [];
    return result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));
  }

  async createDraft(
    admin: AdminMe,
    payload: unknown,
    comment: string,
  ): Promise<AdminConfigVersion> {
    this.assertValid(payload);
    return this.prisma.transaction(async (tx) => {
      const row = await tx.gameConfigVersion.create({
        data: {
          payload: payload as Prisma.InputJsonValue,
          status: ConfigStatus.draft,
          comment,
          createdBy: admin.login,
        },
      });
      await auditAdmin(tx, admin, 'config.draft', target(row.id), comment);
      return summary(row);
    });
  }

  /** Editing a draft (or a simulated one) makes it a draft again: the old simulation is void. */
  async updateDraft(
    admin: AdminMe,
    id: number,
    payload: unknown,
    comment: string,
  ): Promise<AdminConfigVersion> {
    this.assertValid(payload);
    const row = await this.find(id);
    if (row.status !== ConfigStatus.draft && row.status !== ConfigStatus.simulated)
      throw new AppError(ErrorCode.CONFIG_NOT_EDITABLE, HttpStatus.CONFLICT);
    return this.prisma.transaction(async (tx) => {
      const updated = await tx.gameConfigVersion.update({
        where: { id },
        data: {
          payload: payload as Prisma.InputJsonValue,
          status: ConfigStatus.draft,
          simulationReport: Prisma.DbNull,
          comment,
        },
      });
      await auditAdmin(tx, admin, 'config.update', target(id), comment);
      return summary(updated);
    });
  }

  /** Changes from `againstId` (the active version by default) to `id`. */
  async diff(id: number, againstId?: number): Promise<ConfigDiffEntry[]> {
    const row = await this.find(id);
    const base = againstId
      ? await this.find(againstId)
      : await this.prisma.gameConfigVersion.findFirst({ where: { status: ConfigStatus.active } });
    return diffConfig(base?.payload ?? {}, row.payload);
  }

  async simulate(
    admin: AdminMe,
    id: number,
    spins = DEFAULT_SIM_SPINS,
  ): Promise<ConfigSimulationReport> {
    const row = await this.find(id);
    if (row.status !== ConfigStatus.draft && row.status !== ConfigStatus.simulated)
      throw new AppError(ErrorCode.CONFIG_NOT_EDITABLE, HttpStatus.CONFLICT);
    const report = await runSimulation(parseConfig(row.payload), spins);
    await this.prisma.transaction(async (tx) => {
      await tx.gameConfigVersion.update({
        where: { id },
        data: {
          simulationReport: report as unknown as Prisma.InputJsonValue,
          status: report.ok ? ConfigStatus.simulated : ConfigStatus.draft,
        },
      });
      await auditAdmin(tx, admin, 'config.simulate', target(id), null, {
        ok: report.ok,
        spinsPerPack: spins,
      });
    });
    return report;
  }

  /**
   * Activates a simulated version (its RTP passed) or, as a rollback, an archived one. The current
   * active version is archived first (at most one is active).
   */
  async activate(admin: AdminMe, id: number, reason: string): Promise<void> {
    const row = await this.find(id);
    const rollback = row.status === ConfigStatus.archived;
    const simulated =
      row.status === ConfigStatus.simulated &&
      (row.simulationReport as ConfigSimulationReport | null)?.ok === true;
    if (!rollback && !simulated)
      throw new AppError(ErrorCode.CONFIG_NOT_SIMULATED, HttpStatus.CONFLICT);
    await this.prisma.transaction(async (tx) => {
      const previous = await tx.gameConfigVersion.findFirst({
        where: { status: ConfigStatus.active },
      });
      if (previous)
        await tx.gameConfigVersion.update({
          where: { id: previous.id },
          data: { status: ConfigStatus.archived },
        });
      await tx.gameConfigVersion.update({
        where: { id },
        data: { status: ConfigStatus.active, activatedAt: new Date() },
      });
      await auditAdmin(
        tx,
        admin,
        rollback ? 'config.rollback' : 'config.activate',
        target(id),
        reason,
        {
          previous: previous?.id ?? null,
        },
      );
    });
    await this.config.invalidate();
  }

  // ─── A/B stub ────────────────────────────────────────────────────────────

  async experiments(): Promise<AdminExperiment[]> {
    const rows = await this.prisma.gameConfigExperiment.findMany({ orderBy: { group: 'asc' } });
    const counts = await this.prisma.user.groupBy({
      by: ['experimentGroup'],
      where: { experimentGroup: { in: rows.map((r) => r.group) } },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      group: r.group,
      versionId: r.versionId,
      users: counts.find((c) => c.experimentGroup === r.group)?._count._all ?? 0,
    }));
  }

  /** Binds a group to a version that passed simulation (or was active); null unbinds. */
  async bindExperiment(admin: AdminMe, group: string, versionId: number | null, reason: string) {
    if (versionId !== null) {
      const row = await this.find(versionId);
      if (row.status === ConfigStatus.draft)
        throw new AppError(ErrorCode.CONFIG_NOT_SIMULATED, HttpStatus.CONFLICT);
    }
    await this.prisma.transaction(async (tx) => {
      if (versionId === null) await tx.gameConfigExperiment.deleteMany({ where: { group } });
      else
        await tx.gameConfigExperiment.upsert({
          where: { group },
          create: { group, versionId, createdBy: admin.login },
          update: { versionId, createdBy: admin.login },
        });
      await auditAdmin(tx, admin, 'config.experiment', { type: 'experiment', id: group }, reason, {
        versionId,
      });
    });
    await this.config.invalidate();
  }

  private assertValid(payload: unknown): void {
    if (this.validate(payload).length > 0)
      throw new AppError(ErrorCode.CONFIG_INVALID, HttpStatus.BAD_REQUEST);
  }

  private async find(id: number): Promise<GameConfigVersion> {
    const row = await this.prisma.gameConfigVersion.findUnique({ where: { id } });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
    return row;
  }
}

/** Every enabled paid pack in every region whose currency it is sold for (TZ 5.8). */
export async function runSimulation(
  config: GameConfig,
  spins: number,
): Promise<ConfigSimulationReport> {
  const items: ConfigSimulationReport['items'] = [];
  for (const pack of config.packs.filter((p) => p.enabled && !p.free)) {
    for (const region of REGIONS) {
      if (pack.prices[config.regions[region].currency] === undefined) continue;
      const scenarios = [
        {
          scenario: 'regular' as const,
          cardPaymentShareBp: SIM_CARD_SHARE_BP,
          level: 1,
        },
        // D-141: players pay with their best card, so the corridor must hold at the luck cap.
        {
          scenario: 'bestCard' as const,
          cardPaymentShareBp: 10_000,
          cardLuckPoints: config.luck.maxPoints,
          level: config.simulation.bestCardLevel,
        },
      ];
      for (const { scenario, ...options } of scenarios) {
        const report = await simulate({
          config,
          packId: pack.id,
          region,
          spins,
          players: Math.max(1, Math.min(1000, Math.floor(spins / 50))),
          seed: SIM_SEED,
          // D-116: the corridor is about a regular player, not the newcomer's hidden starter luck.
          startSpins: config.luck.hidden.newbieSpins,
          ...options,
        });
        items.push({
          packId: pack.id,
          region,
          scenario,
          currency: report.currency,
          spins: report.spins,
          rtpBp: report.rtp?.overallBp ?? null,
          inCorridor: report.rtp?.inCorridor ?? true,
          tiers: Object.fromEntries(
            Object.entries(report.tiers).map(([tier, t]) => [
              tier,
              { actualBp: t.actualBp, configuredBp: t.configuredBp },
            ]),
          ),
          nearMissShareBp: report.nearMiss.shareBp,
          patternedShareBp: report.patterns.patternedShareBp,
        });
      }
    }
  }
  const corridor = config.simulation.rtpCorridor;
  // D-169: every mini-game choice (mine count, moment of taking the money, board) in the corridor.
  const minigames = config.minigames
    ? miniGameReturns(config.minigames, createSeededRng(SIM_SEED), SIM_BLACKJACK_ROUNDS).map(
        (r) => ({ ...r, inCorridor: r.minBp >= corridor.minBp && r.maxBp <= corridor.maxBp }),
      )
    : [];
  // D-170: the crafted card is worth the craft fee on average (corridor).
  const craft = (await craftReturns(config, createSeededRng(SIM_SEED), SIM_CRAFTS)).map((r) => ({
    ...r,
    inCorridor: r.returnBp >= corridor.minBp && r.returnBp <= corridor.maxBp,
  }));
  return {
    ok:
      items.length > 0 &&
      items.every((i) => i.inCorridor) &&
      minigames.every((m) => m.inCorridor) &&
      craft.every((c) => c.inCorridor),
    ranAt: new Date().toISOString(),
    spinsPerPack: spins,
    corridor,
    items,
    minigames,
    craft,
  };
}

function summary(row: GameConfigVersion): AdminConfigVersion {
  const report = row.simulationReport as ConfigSimulationReport | null;
  return {
    id: row.id,
    status: row.status,
    comment: row.comment,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    simulationOk: report ? report.ok : null,
  };
}

const target = (id: number) => ({ type: 'config', id: String(id) });
