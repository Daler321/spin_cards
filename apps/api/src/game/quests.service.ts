import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  advanceQuest,
  levelForExp,
  pickDailyQuests,
  type QuestEvent,
  type QuestMeta,
} from '@spincards/game-core';
import {
  type ChannelQuestClaimResponse,
  type ChannelQuestView,
  ErrorCode,
  type GameConfig,
  type InviteQuestView,
  nextQuestReset,
  type QuestClaimResponse,
  type QuestDef,
  type QuestMetric,
  type QuestReward,
  type QuestsResponse,
  type QuestView,
  questDay,
  scaleDailyReward,
} from '@spincards/shared';
import type { Redis } from 'ioredis';
import { AppError } from '../common/app-error.js';
import { FlagsService } from '../game-config/flags.service.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import {
  CardStatus,
  LedgerReason,
  type Prisma,
  type QuestProgress,
  QuestKind,
  ReferralStatus,
  type User,
} from '../generated/prisma/client.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';
import { SubscriptionService } from '../subscription/subscription.service.js';
import { AchievementsService } from './achievements.service.js';
import { grantReward } from './grant-reward.js';
import { cryptoRng } from './crypto-rng.js';
import { lockPlayer } from './player-lock.js';

export interface QuestContext {
  config: GameConfig;
  seasonId: string;
  now: Date;
}

const HOUR_MS = 3600_000;
/** The channel quest's row in quest_progress (a season quest outside `quests.season`, D-157). */
export const CHANNEL_QUEST_ID = 'channel_sub';
/** D-158: one row per reached step of the invite quest, `invite_<friends>`. */
export const inviteQuestId = (friends: number) => `invite_${String(friends)}`;

/**
 * Daily and season quests (D-124). Game actions report events inside their own transaction (the
 * player row is locked there), so progress moves together with the action or not at all. Daily
 * quests are drawn when the player first acts on a Moscow day; season quests once per season.
 */
@Injectable()
export class QuestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly idempotency: IdempotencyService,
    private readonly flags: FlagsService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly achievements: AchievementsService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /** Advances the player's open quests; call inside the action's transaction. */
  async record(
    tx: Tx,
    user: { id: string; level: number },
    events: QuestEvent[],
    ctx: QuestContext,
  ): Promise<void> {
    const rows = await this.openRows(tx, user, ctx);
    // A hold changes the holder: measure it so holder quests see the new state.
    const all = events.some((e) => e.type === 'hold' || e.type === 'visit')
      ? [...events, await holderEvent(tx, user.id, ctx.now)]
      : events;
    for (const row of rows) {
      if (row.completedAt) continue;
      const meta = row.meta as QuestMeta;
      const next = advanceQuest(
        { metric: row.metric as QuestMetric, tier: row.tier, progress: row.progress, meta },
        all,
      );
      const progress = Math.min(next.progress, row.target);
      if (progress === row.progress && JSON.stringify(next.meta) === JSON.stringify(meta)) continue;
      await tx.questProgress.update({
        where: { id: row.id },
        data: {
          progress,
          meta: next.meta as Prisma.InputJsonValue,
          ...(progress >= row.target && { completedAt: ctx.now }),
        },
      });
    }
  }

  /** The first visit of a Moscow day counts for `visit_days` (once per day, cheap afterwards). */
  async visit(userId: string): Promise<void> {
    const now = new Date();
    const key = `quest:visit:${userId}:${questDay(now)}`;
    if ((await this.redis.set(key, '1', 'EX', 2 * 24 * 3600, 'NX')) !== 'OK') return;
    try {
      const ctx = await this.context(now);
      await this.prisma.transaction(async (tx) => {
        await lockPlayer(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        await this.record(tx, user, [{ type: 'visit', day: questDay(now) }], ctx);
      });
    } catch (error) {
      await this.redis.del(key);
      throw error;
    }
  }

  /** Completed, unclaimed quests of today and of the season (the Bonuses tab badge). */
  async readyCount(userId: string, now = new Date()): Promise<number> {
    const seasonId = await this.seasons.currentSeasonId();
    const dailyIds = (await this.config.active()).config.quests.daily.map((q) => q.id);
    return this.prisma.questProgress.count({
      where: {
        userId,
        completedAt: { not: null },
        claimedAt: null,
        questId: {
          in: [...(await this.config.active()).config.quests.season.map((q) => q.id), ...dailyIds],
        },
        OR: [
          { kind: QuestKind.daily, period: questDay(now) },
          { kind: QuestKind.season, period: seasonId },
        ],
      },
    });
  }

  async list(userId: string): Promise<QuestsResponse> {
    const ctx = await this.context(new Date());
    const rows = await this.prisma.transaction(async (tx) => {
      await lockPlayer(tx, userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      await this.record(tx, user, [await holderEvent(tx, userId, ctx.now)], ctx);
      return { user, rows: await this.openRows(tx, user, ctx) };
    });
    const season = await this.prisma.season.findUnique({ where: { id: ctx.seasonId } });
    const view = (row: QuestProgress) => questView(row, rows.user, ctx.config);
    return {
      daily: rows.rows.filter((r) => r.kind === QuestKind.daily).map(view),
      season: rows.rows.filter((r) => r.kind === QuestKind.season).map(view),
      channel: await this.channelView(rows.user, ctx),
      invite: await this.inviteView(rows.user, ctx),
      dailyResetsAt: nextQuestReset(ctx.now).toISOString(),
      seasonEndsAt: season?.endsAt?.toISOString() ?? null,
    };
  }

  async claim(
    userId: string,
    questId: string,
    idempotencyKey: string,
  ): Promise<QuestClaimResponse> {
    await this.flags.assertNotMaintenance();
    const ctx = await this.context(new Date());
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'quest.claim', payload: { questId } },
      async (tx) => {
        await lockPlayer(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const row = await tx.questProgress.findFirst({ where: { id: questId, userId } });
        const current =
          row &&
          (row.kind === QuestKind.daily
            ? row.period === questDay(ctx.now)
            : row.period === ctx.seasonId);
        if (!row || !current) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
        if (!row.completedAt)
          throw new AppError(ErrorCode.QUEST_NOT_COMPLETED, HttpStatus.CONFLICT);
        if (row.claimedAt) throw new AppError(ErrorCode.QUEST_ALREADY_CLAIMED, HttpStatus.CONFLICT);

        const paid = await this.pay(tx, user, row, ctx);
        return {
          quest: questView(paid.row, { ...user, level: paid.exp.level }, ctx.config),
          credited: paid.credited,
          exp: paid.exp,
        };
      },
    );
  }

  /**
   * "I joined the channel" (D-157): Telegram is asked first (outside the transaction); the reward
   * is paid once a season, like a season quest.
   */
  async claimChannel(userId: string, idempotencyKey: string): Promise<ChannelQuestClaimResponse> {
    await this.flags.assertNotMaintenance();
    const ctx = await this.context(new Date());
    const def = ctx.config.quests.channel;
    const { channels } = await this.subscriptions.settings();
    if (!def || channels.length === 0)
      throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
    const { telegramId } = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { telegramId: true },
    });
    if (!(await this.subscriptions.joinedAll(telegramId)))
      throw new AppError(ErrorCode.CHANNEL_NOT_JOINED, HttpStatus.CONFLICT);
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'quest.channel', payload: {} },
      async (tx) => {
        await lockPlayer(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const unique = {
          userId,
          kind: QuestKind.season,
          period: ctx.seasonId,
          questId: CHANNEL_QUEST_ID,
        };
        const existing = await tx.questProgress.findUnique({
          where: { userId_kind_period_questId: unique },
        });
        if (existing?.claimedAt)
          throw new AppError(ErrorCode.QUEST_ALREADY_CLAIMED, HttpStatus.CONFLICT);
        const row =
          existing ??
          (await tx.questProgress.create({
            data: {
              ...unique,
              seasonId: ctx.seasonId,
              metric: CHANNEL_QUEST_ID,
              target: 1,
              progress: 1,
              completedAt: ctx.now,
              reward: def.reward,
            },
          }));
        const { credited, exp } = await this.pay(tx, user, row, ctx);
        return { credited, exp };
      },
    );
  }

  /**
   * "Invite friends" (D-158): the reward of one step once enough friends qualified this season;
   * each step is paid once a season.
   */
  async claimInvite(
    userId: string,
    friends: number,
    idempotencyKey: string,
  ): Promise<ChannelQuestClaimResponse> {
    await this.flags.assertNotMaintenance();
    const ctx = await this.context(new Date());
    const step = ctx.config.quests.invite?.steps.find((s) => s.friends === friends);
    if (!step) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
    return this.idempotency.run(
      { userId, key: idempotencyKey, route: 'quest.invite', payload: { friends } },
      async (tx) => {
        await lockPlayer(tx, userId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if ((await this.invitedThisSeason(tx, userId, ctx)) < step.friends)
          throw new AppError(ErrorCode.QUEST_NOT_COMPLETED, HttpStatus.CONFLICT);
        const unique = {
          userId,
          kind: QuestKind.season,
          period: ctx.seasonId,
          questId: inviteQuestId(step.friends),
        };
        const existing = await tx.questProgress.findUnique({
          where: { userId_kind_period_questId: unique },
        });
        if (existing?.claimedAt)
          throw new AppError(ErrorCode.QUEST_ALREADY_CLAIMED, HttpStatus.CONFLICT);
        const row =
          existing ??
          (await tx.questProgress.create({
            data: {
              ...unique,
              seasonId: ctx.seasonId,
              metric: 'invite',
              target: step.friends,
              progress: step.friends,
              completedAt: ctx.now,
              reward: step.reward,
            },
          }));
        const { credited, exp } = await this.pay(tx, user, row, ctx);
        return { credited, exp };
      },
    );
  }

  /** Friends who qualified for the referral reward since the season started (D-158). */
  private async invitedThisSeason(
    tx: Tx | PrismaService,
    userId: string,
    ctx: QuestContext,
  ): Promise<number> {
    const season = await tx.season.findUniqueOrThrow({ where: { id: ctx.seasonId } });
    return tx.referral.count({
      where: {
        referrerId: userId,
        status: ReferralStatus.rewarded,
        rewardedAt: { gte: season.startsAt },
      },
    });
  }

  /** The invite quest while some step is not taken this season (D-158). */
  private async inviteView(
    user: { id: string; level: number; region: 'RU' | 'US' },
    ctx: QuestContext,
  ): Promise<InviteQuestView | null> {
    const def = ctx.config.quests.invite;
    if (!def) return null;
    const claimed = await this.prisma.questProgress.findMany({
      where: {
        userId: user.id,
        kind: QuestKind.season,
        period: ctx.seasonId,
        questId: { in: def.steps.map((s) => inviteQuestId(s.friends)) },
        claimedAt: { not: null },
      },
      select: { questId: true },
    });
    const taken = new Set(claimed.map((r) => r.questId));
    if (def.steps.every((s) => taken.has(inviteQuestId(s.friends)))) return null;
    return {
      friends: await this.invitedThisSeason(this.prisma, user.id, ctx),
      steps: def.steps.map((s) => ({
        friends: s.friends,
        reward: rewardFor({ kind: QuestKind.season, reward: s.reward }, user, ctx.config),
        claimed: taken.has(inviteQuestId(s.friends)),
      })),
      rule: { spins: ctx.config.referral.spinsRequired, level: ctx.config.referral.levelRequired },
    };
  }

  /** Pays a completed quest and marks it claimed; inside the claim transaction. */
  private async pay(
    tx: Tx,
    user: User,
    row: QuestProgress,
    ctx: QuestContext,
  ): Promise<{
    row: QuestProgress;
    credited: QuestClaimResponse['credited'];
    exp: QuestClaimResponse['exp'];
  }> {
    const userId = user.id;
    const reward = rewardFor(row, user, ctx.config);
    const credited = await grantReward(
      this.ledger,
      {
        ...(reward.money && { money: { [reward.money.currency]: reward.money.amount } }),
        ...(reward.luck && { luck: reward.luck }),
        ...(reward.freeSpins && { freeSpins: reward.freeSpins }),
      },
      {
        tx,
        user,
        config: ctx.config,
        seasonId: ctx.seasonId,
        reason: LedgerReason.quest,
        ref: { type: 'quest', id: row.id },
        buffSource: 'quest',
        moneyScaled: true,
      },
    );
    const gained = reward.exp ?? 0;
    const exp = user.exp + gained;
    const level = levelForExp(exp, ctx.config);
    if (gained > 0) await tx.user.update({ where: { id: userId }, data: { exp, level } });
    const claimed = await tx.questProgress.update({
      where: { id: row.id },
      data: { claimedAt: ctx.now },
    });
    const season = await this.seasons.current();
    await this.achievements.record(
      tx,
      { ...user, exp, level },
      { quests: await tx.questProgress.count({ where: { userId, claimedAt: { not: null } } }) },
      { config: ctx.config, seasonId: ctx.seasonId, seasonName: season.name },
    );
    return { row: claimed, credited, exp: { gained, total: exp, level } };
  }

  /** The channel quest while its reward is not taken this season (D-157). */
  private async channelView(
    user: { id: string; level: number; region: 'RU' | 'US' },
    ctx: QuestContext,
  ): Promise<ChannelQuestView | null> {
    const def = ctx.config.quests.channel;
    if (!def) return null;
    const { channels } = await this.subscriptions.settings();
    if (channels.length === 0) return null;
    const row = await this.prisma.questProgress.findUnique({
      where: {
        userId_kind_period_questId: {
          userId: user.id,
          kind: QuestKind.season,
          period: ctx.seasonId,
          questId: CHANNEL_QUEST_ID,
        },
      },
      select: { claimedAt: true },
    });
    if (row?.claimedAt) return null;
    const reward = rewardFor({ kind: QuestKind.season, reward: def.reward }, user, ctx.config);
    return { channels: channels.map((c) => ({ title: c.title, url: c.url })), reward };
  }

  private async context(now: Date): Promise<QuestContext> {
    const [{ config }, seasonId] = await Promise.all([
      this.config.active(),
      this.seasons.currentSeasonId(),
    ]);
    return { config, seasonId, now };
  }

  /** Today's daily quests and the season's, drawing them first if needed. */
  private async openRows(
    tx: Tx,
    user: { id: string; level: number },
    ctx: QuestContext,
  ): Promise<QuestProgress[]> {
    const day = questDay(ctx.now);
    const where: Prisma.QuestProgressWhereInput = {
      userId: user.id,
      OR: [
        { kind: QuestKind.daily, period: day },
        { kind: QuestKind.season, period: ctx.seasonId },
      ],
    };
    const quests = ctx.config.quests;
    // Season quests dropped from the config are no longer shown or counted.
    const inConfig = new Set(quests.season.map((q) => q.id));
    const current = (list: QuestProgress[]) =>
      list.filter((r) => r.kind === QuestKind.daily || inConfig.has(r.questId));
    const rows = current(await tx.questProgress.findMany({ where, orderBy: { createdAt: 'asc' } }));
    const missing: Prisma.QuestProgressCreateManyInput[] = [];
    if (!rows.some((r) => r.kind === QuestKind.daily)) {
      for (const def of pickDailyQuests(cryptoRng, quests.daily, quests.dailyCount, user.level))
        missing.push(newRow(user.id, ctx.seasonId, QuestKind.daily, day, def));
    }
    const seasonIds = new Set(
      rows.filter((r) => r.kind === QuestKind.season).map((r) => r.questId),
    );
    for (const def of quests.season)
      if (!seasonIds.has(def.id))
        missing.push(newRow(user.id, ctx.seasonId, QuestKind.season, ctx.seasonId, def));
    if (missing.length === 0) return rows;
    await tx.questProgress.createMany({ data: missing, skipDuplicates: true });
    return current(await tx.questProgress.findMany({ where, orderBy: { createdAt: 'asc' } }));
  }
}

function newRow(
  userId: string,
  seasonId: string,
  kind: QuestKind,
  period: string,
  def: QuestDef,
): Prisma.QuestProgressCreateManyInput {
  return {
    userId,
    seasonId,
    kind,
    period,
    questId: def.id,
    metric: def.metric,
    target: def.target,
    tier: def.tier ?? null,
    reward: def.reward,
  };
}

/** Held cards now and the longest current hold (whole hours). */
async function holderEvent(tx: Tx, userId: string, now: Date): Promise<QuestEvent> {
  const held = await tx.card.findMany({
    where: { ownerId: userId, status: CardStatus.active, heldAt: { not: null } },
    select: { heldAt: true },
  });
  const longest = held.reduce(
    (max, c) => Math.max(max, c.heldAt ? now.getTime() - c.heldAt.getTime() : 0),
    0,
  );
  return { type: 'holder', size: held.length, longestHoldHours: Math.floor(longest / HOUR_MS) };
}

/** Daily quest money grows with the level like the daily reward (D-113); season rewards are fixed. */
function rewardFor(
  row: Pick<QuestProgress, 'kind' | 'reward'>,
  user: { level: number; region: 'RU' | 'US' },
  config: GameConfig,
): QuestView['reward'] {
  const reward = row.reward as QuestReward;
  const currency = config.regions[user.region].currency;
  const money =
    row.kind === QuestKind.daily && reward.money
      ? scaleDailyReward({ money: reward.money }, user.level, config.daily).money
      : reward.money;
  const amount = money?.[currency];
  return {
    money: amount ? { currency, amount } : null,
    luck: reward.luck ?? null,
    freeSpins: reward.freeSpins ?? null,
    exp: reward.exp ?? null,
  };
}

function questView(
  row: QuestProgress,
  user: { level: number; region: 'RU' | 'US' },
  config: GameConfig,
): QuestView {
  return {
    id: row.id,
    questId: row.questId,
    kind: row.kind,
    metric: row.metric as QuestMetric,
    tier: row.tier,
    target: row.target,
    progress: row.progress,
    reward: rewardFor(row, user, config),
    completed: row.completedAt !== null,
    claimed: row.claimedAt !== null,
  };
}
