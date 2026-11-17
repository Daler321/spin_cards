import { Injectable } from '@nestjs/common';
import { type AchievementFacts, earnedAchievements, levelForExp } from '@spincards/game-core';
import type {
  AchievementDef,
  AchievementsResponse,
  GameConfig,
  PatternId,
  Tier,
} from '@spincards/shared';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { CardStatus, LedgerReason, type User } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { grantReward } from './grant-reward.js';
import { medalRarity, shownMedals } from './medals.js';
import { netWorthRub } from './season-score.js';

export interface AchievementContext {
  config: GameConfig;
  seasonId: string;
  seasonName: string;
}

/**
 * Achievements and medals (D-133). Actions report facts inside their transaction; every newly met
 * achievement is recorded once (permanent: once ever, season: once per season) and its reward is
 * paid through the ledger at once.
 */
@Injectable()
export class AchievementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
  ) {}

  /** Grants what the facts newly satisfy; returns the ids granted now. */
  async record(
    tx: Tx,
    user: User,
    facts: AchievementFacts,
    ctx: AchievementContext,
  ): Promise<string[]> {
    const candidates = earnedAchievements(ctx.config.achievements, facts);
    if (candidates.length === 0) return [];
    const granted: string[] = [];
    for (const id of candidates) if (await this.grant(tx, user, id, ctx)) granted.push(id);
    return granted;
  }

  /** Records one achievement with its reward; false if the player already has it (in its scope). */
  async grant(
    tx: Tx,
    user: User,
    achievementId: string,
    ctx: AchievementContext,
  ): Promise<boolean> {
    const def = ctx.config.achievements.find((a) => a.id === achievementId);
    if (!def) return false;
    const scope = def.kind === 'season' ? ctx.seasonId : '';
    const created = await tx.userAchievement.createMany({
      data: [
        {
          userId: user.id,
          achievementId,
          scope,
          ...(def.kind === 'season' && { seasonName: ctx.seasonName }),
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0) return false;
    await this.reward(tx, user, def, ctx);
    return true;
  }

  /** Facts that need a query (trophies, quests, net worth) for the profile check. */
  async refresh(userId: string): Promise<string[]> {
    const ctx = await this.context();
    return this.prisma.transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const [trophies, quests, worth, tiers, patterns] = await Promise.all([
        tx.card.count({ where: { ownerId: userId, status: CardStatus.trophy } }),
        tx.questProgress.count({ where: { userId, claimedAt: { not: null } } }),
        netWorthRub(tx, userId),
        // Cards dropped earlier this season count too; earlier seasons do not (D-151): after a
        // fresh start (D-149) the alpha's spins must not bring the medals back.
        tx.$queryRaw<{ tier: Tier }[]>`
          SELECT DISTINCT c.tier FROM spins s JOIN cards c ON c.id = s.card_id
          WHERE s.user_id = ${userId}::uuid AND s.season_id = ${ctx.seasonId}::uuid`,
        tx.$queryRaw<{ id: PatternId }[]>`
          SELECT DISTINCT p.value ->> 'id' AS id FROM spins s JOIN cards c ON c.id = s.card_id
          CROSS JOIN LATERAL jsonb_array_elements(c.number_patterns) AS p(value)
          WHERE s.user_id = ${userId}::uuid AND s.season_id = ${ctx.seasonId}::uuid`,
      ]);
      return this.record(
        tx,
        user,
        {
          cards: [
            ...tiers.map((r) => ({ tier: r.tier, patterns: [] })),
            { tier: 'common', patterns: patterns.map((r) => r.id) },
          ],
          totalSpins: user.totalSpins,
          level: user.level,
          trophies,
          quests,
          netWorthRub: worth,
        },
        ctx,
      );
    });
  }

  async list(userId: string): Promise<AchievementsResponse> {
    await this.refresh(userId);
    const { config } = await this.config.active();
    const [earned, rarity, shown] = await Promise.all([
      this.prisma.userAchievement.findMany({ where: { userId }, orderBy: { earnedAt: 'desc' } }),
      medalRarity(this.prisma),
      shownMedals(this.prisma, config, [userId]),
    ]);
    const mine = shown.get(userId) ?? { ids: [], chosen: false };
    return {
      shown: mine.ids,
      chosen: mine.chosen,
      achievements: config.achievements.map((def) => ({
        id: def.id,
        icon: def.icon,
        kind: def.kind,
        condition: def.condition,
        reward: def.reward,
        earned: earned
          .filter((e) => e.achievementId === def.id)
          .map((e) => ({ at: e.earnedAt.toISOString(), season: e.seasonName })),
        holdersBp:
          rarity.players > 0
            ? Math.round(((rarity.holders.get(def.id) ?? 0) * 10_000) / rarity.players)
            : 0,
      })),
    };
  }

  async context(): Promise<AchievementContext> {
    const [{ config }, season] = await Promise.all([this.config.active(), this.seasons.current()]);
    return { config, seasonId: season.id, seasonName: season.name };
  }

  private async reward(
    tx: Tx,
    user: User,
    def: AchievementDef,
    ctx: AchievementContext,
  ): Promise<void> {
    if (def.reward.money)
      await grantReward(
        this.ledger,
        { money: def.reward.money },
        {
          tx,
          user,
          config: ctx.config,
          seasonId: ctx.seasonId,
          reason: LedgerReason.achievement,
          ref: { type: 'achievement', id: `${def.id}:${user.id}` },
          buffSource: 'achievement',
          moneyScaled: true,
        },
      );
    if (def.reward.exp) {
      const fresh = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { exp: true },
      });
      const exp = fresh.exp + def.reward.exp;
      await tx.user.update({
        where: { id: user.id },
        data: { exp, level: levelForExp(exp, ctx.config) },
      });
    }
  }
}
