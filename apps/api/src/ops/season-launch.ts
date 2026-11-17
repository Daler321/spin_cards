import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_REGION, STARTER_HOLDER_ID } from '@spincards/shared';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import {
  CardStatus,
  LedgerAccountType,
  LedgerReason,
  OutboxStatus,
  SeasonStatus,
} from '../generated/prisma/client.js';
import { lockPlayer } from '../game/player-lock.js';
import { LeaderboardService } from '../leaderboard/leaderboard.service.js';
import { LedgerService, type Posting } from '../ledger/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SeasonLaunchOptions {
  name: string;
  startsAt: Date;
  endsAt: Date;
  /** Previous seasons get this name (e.g. "Альфа"), so the new one can reuse its name. */
  renameOldTo?: string | undefined;
  /** Also forget who invited whom. */
  resetReferrals: boolean;
  /** False: count only (dry run). */
  confirm: boolean;
}

export interface SeasonLaunchReport {
  seasonId: string | null;
  players: number;
  reset: number;
  skipped: number;
  cards: number;
  achievements: number;
  referrals: number;
}

/**
 * D-149: a fresh start for everybody (leaving the alpha). The active season ends without results
 * or medals, a new one opens with fixed dates, and every player starts over: all cards (album
 * included) leave the game, wallets go to zero and get the start money through the ledger, level,
 * spins, medals, quests, chest, daily streak, luck bonuses and counters, bought holders and album
 * slots are reset. Ledger, spins, payments and transfers stay as history (they cannot be deleted).
 * Safe to run again: a player who already got the new season's start money is skipped.
 */
@Injectable()
export class SeasonLaunchService {
  private readonly logger = new Logger(SeasonLaunchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly ledger: LedgerService,
    private readonly leaderboards: LeaderboardService,
  ) {}

  async run(options: SeasonLaunchOptions): Promise<SeasonLaunchReport> {
    const [players, cards, achievements, referrals] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.card.count({
        where: { status: { in: [CardStatus.active, CardStatus.expired, CardStatus.trophy] } },
      }),
      this.prisma.userAchievement.count(),
      this.prisma.referral.count(),
    ]);
    const report: SeasonLaunchReport = {
      seasonId: null,
      players,
      reset: 0,
      skipped: 0,
      cards,
      achievements,
      referrals: options.resetReferrals ? referrals : 0,
    };
    if (!options.confirm) return report;

    const season = await this.openSeason(options);
    report.seasonId = season.id;
    await this.resetShared(options.resetReferrals);
    const { config } = await this.config.active();
    const users = await this.prisma.user.findMany({ select: { id: true } });
    for (const { id } of users) {
      if (await this.resetPlayer(id, season.id, config.startingBalance)) report.reset++;
      else report.skipped++;
    }
    await this.leaderboards.rebuild().catch((error: unknown) => {
      this.logger.warn({ err: error }, 'leaderboards not rebuilt (the worker will)');
    });
    await this.prisma.auditLog.create({
      data: {
        actorType: 'system',
        actorId: 'season-launch',
        action: 'season.launch',
        targetType: 'season',
        targetId: season.id,
        reason: `Fresh start: season ${options.name}`,
        payload: {
          startsAt: options.startsAt.toISOString(),
          endsAt: options.endsAt.toISOString(),
          players: report.players,
          reset: report.reset,
          resetReferrals: options.resetReferrals,
        },
      },
    });
    return report;
  }

  /**
   * Ends the active season (no results, no medals) and opens the new one. Every player is marked
   * as being in the new season in the same transaction, so the season worker never starts its own
   * (partial) reset meanwhile.
   */
  private async openSeason(options: SeasonLaunchOptions) {
    const season = await this.prisma.transaction(async (tx) => {
      const existing = await tx.season.findFirst({
        where: { status: SeasonStatus.active, name: options.name, startsAt: options.startsAt },
      });
      if (existing) return existing;
      const now = new Date();
      if (options.renameOldTo)
        await tx.season.updateMany({
          where: { name: options.name },
          data: { name: options.renameOldTo },
        });
      await tx.season.updateMany({
        where: { status: SeasonStatus.active },
        data: { status: SeasonStatus.finished, endsAt: now },
      });
      const created = await tx.season.create({
        data: {
          name: options.name,
          startsAt: options.startsAt,
          endsAt: options.endsAt,
          status: SeasonStatus.active,
        },
      });
      await tx.user.updateMany({ data: { moneySeasonId: created.id } });
      return created;
    });
    await this.seasons.refresh();
    return season;
  }

  /** Rows that hold game progress and no money: removed for everybody at once. */
  private async resetShared(resetReferrals: boolean): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      await tx.userAchievement.deleteMany({});
      await tx.questProgress.deleteMany({});
      await tx.userBuff.deleteMany({});
      await tx.userCounter.deleteMany({});
      await tx.dailyStreak.deleteMany({});
      // Bought holders only: the free starter one stays (D-150).
      await tx.userHolder.deleteMany({ where: { holderId: { not: STARTER_HOLDER_ID } } });
      await tx.albumEntry.deleteMany({});
      await tx.notificationOutbox.updateMany({
        where: { status: OutboxStatus.pending },
        data: { status: OutboxStatus.skipped, lastError: 'season_launch' },
      });
      if (resetReferrals) {
        await tx.referral.deleteMany({});
        await tx.user.updateMany({ data: { referrerId: null } });
      }
    });
  }

  /** One player: every card out of the game, money to zero and the start money; false if done. */
  private async resetPlayer(
    userId: string,
    seasonId: string,
    startingBalance: Partial<Record<string, number>>,
  ): Promise<boolean> {
    return this.prisma.transaction(async (tx) => {
      await lockPlayer(tx, userId);
      const ref = { type: 'season', id: seasonId };
      const done = await tx.ledgerEntry.findFirst({
        where: { userId, reason: LedgerReason.season_start, refType: 'season', refId: seasonId },
        select: { id: true },
      });
      if (done) return false;
      const postings: Posting[] = [];
      const cards = await tx.card.findMany({
        where: {
          ownerId: userId,
          status: { in: [CardStatus.active, CardStatus.expired, CardStatus.trophy] },
        },
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
      if (postings.length > 0) await this.ledger.post(tx, postings, { seasonId });
      await tx.card.updateMany({
        where: { id: { in: cards.map((c) => c.id) } },
        data: { status: CardStatus.cashed, ownerId: null, heldAt: null, graceUntil: null },
      });

      const { config } = await this.config.active();
      // D-156: everybody starts in rubles (the dollar region is one tap away).
      const currency = config.regions[DEFAULT_REGION].currency;
      const start = startingBalance[currency] ?? 0;
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
          { seasonId },
        );
      await tx.user.update({
        where: { id: userId },
        data: {
          level: 1,
          exp: 0,
          totalSpins: 0,
          moneySeasonId: seasonId,
          region: DEFAULT_REGION,
          returnLuckyPending: false,
          freeSpinsAvailable: config.freeSpins.maxStored,
          freeSpinsAnchorAt: new Date(),
          chestSpinsUsed: 0,
          chestLevel: 1,
          wheelSpunAt: null,
          guaranteedFloor: null,
          showcaseSlots: 0,
          pinnedMedals: [],
        },
      });
      return true;
    });
  }
}
