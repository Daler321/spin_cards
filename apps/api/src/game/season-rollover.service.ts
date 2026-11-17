import { Injectable, Logger } from '@nestjs/common';
import { seasonCarryover, seasonMedal, seasonScore } from '@spincards/game-core';
import { DEFAULT_REGION, type GameConfig, TIERS } from '@spincards/shared';
import { GameConfigService } from '../game-config/game-config.service.js';
import { FlagsService } from '../game-config/flags.service.js';
import { SeasonService } from '../game-config/season.service.js';
import {
  CardStatus,
  LedgerAccountType,
  LedgerReason,
  type Season,
  SeasonStatus,
} from '../generated/prisma/client.js';
import { LeaderboardService } from '../leaderboard/leaderboard.service.js';
import { LedgerService, type Posting } from '../ledger/ledger.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { AchievementsService } from './achievements.service.js';
import { lockPlayer } from './player-lock.js';
import { seasonStandings } from './season-score.js';

const DAY_MS = 86_400_000;
const RESET_BATCH = 200;
const MAINTENANCE = 'maintenance_mode';
const NUMBERED = /^Сезон (\d+)$/;

/** D-160: numbered seasons count on from the last «Сезон N»; test seasons (Альфа, Бета) don't count. */
export function nextSeasonName(names: string[]): string {
  const numbers = names.map((n) => NUMBERED.exec(n)?.[1]).filter((n) => n !== undefined);
  return `Сезон ${String(Math.max(0, ...numbers.map(Number)) + 1)}`;
}

/**
 * Season change (D-125, D-132), run by the worker every minute. Gives the active season an end
 * date; once it is over, with the game in maintenance mode: fixes the final standings by season
 * score, hands out the medals, opens the next season and starts every player over — cards burn
 * (album trophies stay), money goes to zero through the ledger, level and EXP reset, and the start
 * money grows with last season's score. Every step can be repeated, so a crash resumes cleanly.
 */
@Injectable()
export class SeasonRolloverService {
  private readonly logger = new Logger(SeasonRolloverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly achievements: AchievementsService,
    private readonly flags: FlagsService,
    private readonly leaderboards: LeaderboardService,
  ) {}

  async run(now = new Date()): Promise<{ closed: string | null; reset: number }> {
    const { config } = await this.config.active();
    const active = await this.prisma.season.findFirst({
      where: { status: SeasonStatus.active },
      orderBy: { startsAt: 'desc' },
    });
    if (!active) return { closed: null, reset: 0 };
    if (!active.endsAt) {
      await this.prisma.season.update({
        where: { id: active.id },
        data: { endsAt: new Date(active.startsAt.getTime() + config.seasons.lengthDays * DAY_MS) },
      });
      await this.seasons.refresh();
    }
    // Players still on an earlier season (a previous run stopped half way) are started over first.
    const pending = await this.prisma.user.count({
      where: { OR: [{ moneySeasonId: null }, { moneySeasonId: { not: active.id } }] },
    });
    if (pending > 0) return { closed: null, reset: await this.resetAll(active, config) };
    if (!active.endsAt || active.endsAt > now) return { closed: null, reset: 0 };

    // Maintenance while scores are fixed and players start over; an admin's own switch is kept.
    const wasOn = await this.flags.isEnabled('maintenance_mode');
    await this.setMaintenance(true);
    try {
      await this.close(active.id, config, { openNext: true });
      await this.seasons.refresh();
      const next = await this.seasons.current();
      const reset = await this.resetAll(next, config);
      return { closed: active.id, reset };
    } finally {
      if (!wasOn) await this.setMaintenance(false);
    }
  }

  /** Final standings, medals and (for the active season) the next one; safe to repeat. */
  async close(seasonId: string, config: GameConfig, options: { openNext: boolean }): Promise<void> {
    const season = await this.prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
    if (season.status === SeasonStatus.finished) return;
    const scored = (await seasonStandings(this.prisma, seasonId))
      .filter((row) => row.played && !row.excluded)
      .map((row) => ({
        ...row,
        score: seasonScore(
          {
            cardPoints: Number(row.cardPoints),
            netWorthRub: Number(row.netWorthRub),
            level: row.level,
          },
          config.seasons.score,
        ).total,
      }))
      .filter((row) => row.score > 0);
    // D-154: one place per player, as in the rating: on equal scores the one who reached it
    // earlier, then the older account (standings come oldest first and the sort is stable).
    const reached = await this.leaderboards.seasonReachedAt(
      seasonId,
      scored.map((r) => r.userId),
    );
    const late = Number.MAX_SAFE_INTEGER;
    scored.sort(
      (a, b) =>
        b.score - a.score || (reached.get(a.userId) ?? late) - (reached.get(b.userId) ?? late),
    );
    const complete = await this.completeCollections(seasonId);
    const ctx = { config, seasonId, seasonName: season.name };

    for (const [index, row] of scored.entries()) {
      const rank = index + 1;
      // D-156: everybody starts the next season in rubles, so the bonus is in rubles too.
      const currency = config.regions[DEFAULT_REGION].currency;
      const carry = seasonCarryover(row.score, currency, config.seasons.carryover);
      await this.prisma.transaction(async (tx) => {
        const created = await tx.seasonResult.createMany({
          data: [
            {
              seasonId,
              userId: row.userId,
              rank,
              points: BigInt(row.score),
              reward: BigInt(carry),
              currency,
            },
          ],
          skipDuplicates: true,
        });
        if (created.count === 0) return;
        const user = await tx.user.findUniqueOrThrow({ where: { id: row.userId } });
        const medal = seasonMedal(rank, config.seasons.medals);
        if (medal) await this.achievements.grant(tx, user, medal, ctx);
        if (complete.has(row.userId))
          await this.achievements.grant(tx, user, 'season_collection', ctx);
        await this.notifications.enqueue(
          [
            {
              userId: row.userId,
              kind: 'season_result',
              params: { season: season.name, rank, amount: carry, currency },
              dedupeKey: `season_result:${seasonId}:${row.userId}`,
            },
          ],
          tx,
        );
      });
    }

    await this.prisma.transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: SeasonStatus }[]>`
        SELECT status FROM seasons WHERE id = ${seasonId}::uuid FOR UPDATE`;
      if (locked?.status === SeasonStatus.finished) return;
      await tx.season.update({
        where: { id: seasonId },
        data: { status: SeasonStatus.finished, endsAt: season.endsAt ?? new Date() },
      });
      if (options.openNext) {
        const names = await tx.season.findMany({ select: { name: true } });
        const startsAt = season.endsAt ?? new Date();
        await tx.season.create({
          data: {
            name: nextSeasonName(names.map((s) => s.name)),
            startsAt,
            endsAt: new Date(startsAt.getTime() + config.seasons.lengthDays * DAY_MS),
            status: SeasonStatus.active,
          },
        });
      }
    });
    this.logger.log({ seasonId, ranked: scored.length }, 'season closed');
  }

  /** Starts every player over in the season `next`; returns how many were reset. */
  async resetAll(next: Season, config: GameConfig): Promise<number> {
    let total = 0;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: { OR: [{ moneySeasonId: null }, { moneySeasonId: { not: next.id } }] },
        select: { id: true },
        take: RESET_BATCH,
      });
      if (users.length === 0) return total;
      for (const { id } of users) await this.resetPlayer(id, next, config);
      total += users.length;
    }
  }

  /** One player into the new season: burn cards, zero wallets, start money, level 1. */
  async resetPlayer(userId: string, next: Season, config: GameConfig): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      await lockPlayer(tx, userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.moneySeasonId === next.id) return;
      const ref = { type: 'season', id: next.id };
      const postings: Posting[] = [];
      const cards = await tx.card.findMany({
        where: { ownerId: userId, status: { in: [CardStatus.active, CardStatus.expired] } },
      });
      for (const card of cards)
        if (card.balance !== 0n)
          postings.push({
            account: { type: LedgerAccountType.card, id: card.id },
            delta: -card.balance,
            reason: LedgerReason.season_reset,
            ref,
          });
      const wallets = await tx.wallet.findMany({ where: { userId } });
      for (const wallet of wallets)
        if (wallet.balance !== 0n)
          postings.push({
            account: { type: LedgerAccountType.wallet, id: wallet.id },
            delta: -wallet.balance,
            reason: LedgerReason.season_reset,
            ref,
          });
      if (postings.length > 0) await this.ledger.post(tx, postings, { seasonId: next.id });
      // Burnt cards leave the game for good (new seasons bring new banks): no re-drop.
      await tx.card.updateMany({
        where: { id: { in: cards.map((c) => c.id) } },
        data: { status: CardStatus.cashed, ownerId: null, heldAt: null, graceUntil: null },
      });

      // Start money: the configured start plus the carryover of the last finished season, in
      // rubles for everybody (D-156); dollars stay one tap away.
      const currency = config.regions[DEFAULT_REGION].currency;
      const last = await this.lastResult(tx, userId, next.id);
      const start =
        (config.startingBalance[currency] ?? 0) +
        (last?.currency === currency ? Number(last.reward ?? 0n) : 0);
      const wallet = wallets.find((w) => w.currency === currency);
      if (wallet && start > 0)
        await this.ledger.post(
          tx,
          [
            {
              account: { type: LedgerAccountType.wallet, id: wallet.id },
              delta: BigInt(start),
              reason: LedgerReason.season_start,
              ref,
            },
          ],
          { seasonId: next.id },
        );
      await tx.user.update({
        where: { id: userId },
        data: { level: 1, exp: 0, moneySeasonId: next.id, region: DEFAULT_REGION },
      });
    });
  }

  private async lastResult(tx: Tx, userId: string, nextSeasonId: string) {
    return tx.seasonResult.findFirst({
      where: { userId, seasonId: { not: nextSeasonId } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Players who dropped every bank × tier of the season. */
  private async completeCollections(seasonId: string): Promise<Set<string>> {
    const banks = await this.prisma.bank.count();
    const rows = await this.prisma.$queryRaw<{ userId: string }[]>`
      SELECT s.user_id::text AS "userId" FROM spins s JOIN cards c ON c.id = s.card_id
      WHERE s.season_id = ${seasonId}::uuid
      GROUP BY s.user_id
      HAVING count(DISTINCT (c.bank_id, c.tier)) >= ${banks * TIERS.length}`;
    return new Set(rows.map((r) => r.userId));
  }

  private async setMaintenance(enabled: boolean): Promise<void> {
    await this.prisma.featureFlag.updateMany({
      where: { key: MAINTENANCE },
      data: { enabled, updatedBy: 'season-rollover' },
    });
    await this.flags.invalidate();
  }
}
