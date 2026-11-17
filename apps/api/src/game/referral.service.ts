import { Injectable } from '@nestjs/common';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import type { Currency, GameConfig, ReferralsResponse, Region } from '@spincards/shared';
import {
  LedgerAccountType,
  LedgerReason,
  type Prisma,
  ReferralStatus,
} from '../generated/prisma/client.js';
import { LedgerService, type Posting } from '../ledger/ledger.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';

/**
 * Referral rewards (TZ 8): once the invited player has made `spinsRequired` spins and reached
 * `levelRequired`, both players get their reward in the currency of their current region. Checked
 * after every spin and daily claim, inside that transaction. Over the referrer's daily limit the
 * referral stays pending and is rewarded on a later qualifying action.
 */
@Injectable()
export class ReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  async rewardIfQualified(
    tx: Tx,
    referred: { id: string; totalSpins: number; level: number; region: Region },
    config: GameConfig,
    seasonId: string,
  ): Promise<boolean> {
    const rules = config.referral;
    if (referred.totalSpins < rules.spinsRequired || referred.level < rules.levelRequired)
      return false;
    const referral = await tx.referral.findUnique({ where: { referredId: referred.id } });
    if (referral?.status !== ReferralStatus.pending) return false;

    if (rules.dailyLimit > 0) {
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const rewardedToday = await tx.referral.count({
        where: {
          referrerId: referral.referrerId,
          status: ReferralStatus.rewarded,
          rewardedAt: { gte: dayStart },
        },
      });
      if (rewardedToday >= rules.dailyLimit) return false;
    }

    // Conditional update: exactly one transaction flips the referral and pays.
    const { count } = await tx.referral.updateMany({
      where: { id: referral.id, status: ReferralStatus.pending },
      data: { status: ReferralStatus.rewarded, rewardedAt: new Date() },
    });
    if (count === 0) return false;

    const referrer = await tx.user.findUniqueOrThrow({
      where: { id: referral.referrerId },
      select: { id: true, region: true },
    });
    const postings: Posting[] = [];
    for (const [user, rewards] of [
      [referred, rules.referredReward],
      [referrer, rules.referrerReward],
    ] as const) {
      const currency: Currency = config.regions[user.region].currency;
      const amount = rewards[currency];
      if (!amount) continue;
      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { userId_currency: { userId: user.id, currency } },
      });
      postings.push({
        account: { type: LedgerAccountType.wallet, id: wallet.id },
        delta: BigInt(amount),
        reason: LedgerReason.referral,
        ref: { type: 'referral', id: referral.id },
      });
    }
    await this.ledger.post(tx, postings, { seasonId });

    await this.notifications.enqueue(
      [
        {
          userId: referrer.id,
          kind: 'referral_reward',
          params: { share: rules.commission.shareBp / 100, days: rules.commission.days },
          dedupeKey: `referral_reward:${referral.id}`,
        },
      ],
      tx,
    );
    return true;
  }

  async list(userId: string, config: GameConfig): Promise<ReferralsResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { referralCode: true },
    });
    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { referred: { select: { firstName: true, totalSpins: true, level: true } } },
    });
    const earned = await this.prisma.ledgerEntry.groupBy({
      by: ['refId', 'currency'],
      where: {
        userId,
        reason: LedgerReason.referral,
        // D-177: the reward for the friend and the commission on their spins.
        refType: { in: [REWARD_REF, COMMISSION_REF] },
        refId: { in: referrals.map((r) => r.id) },
      },
      _sum: { delta: true },
    });
    return {
      code: user.referralCode,
      spinsRequired: config.referral.spinsRequired,
      levelRequired: config.referral.levelRequired,
      invited: referrals.map((r) => ({
        firstName: r.referred.firstName,
        status: r.status,
        spins: r.referred.totalSpins,
        level: r.referred.level,
        joinedAt: r.createdAt.toISOString(),
        earned: earned
          .filter((e) => e.refId === r.id)
          .map((e) => ({ currency: e.currency, amount: Number(e._sum.delta ?? 0n) })),
        commissionUntil: commissionEnd(r.createdAt, config).toISOString(),
      })),
    };
  }
}

const COMMISSION_REF = 'referral_commission';
const REWARD_REF = 'referral';
const DAY_MS = 86_400_000;
const COMMISSION_BATCH = 200;

function commissionEnd(joinedAt: Date, config: GameConfig): Date {
  return new Date(joinedAt.getTime() + config.referral.commission.days * DAY_MS);
}

/**
 * Referral commission (D-108), run by the worker: for every qualified referral still inside its
 * window, the referrer is credited `shareBp` of the friend's paid spins since the last payout, in
 * each spin's currency. Separate transactions per referral keep the two players' locks apart.
 */
@Injectable()
export class ReferralCommissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
  ) {}

  async run(now = new Date()): Promise<{ referrals: number; paid: number }> {
    const { config } = await this.config.active();
    const { shareBp, days } = config.referral.commission;
    if (shareBp === 0) return { referrals: 0, paid: 0 };
    const seasonId = await this.seasons.currentSeasonId();
    const open = await this.prisma.referral.findMany({
      where: {
        status: ReferralStatus.rewarded,
        createdAt: { gte: new Date(now.getTime() - (days + 1) * DAY_MS) },
      },
      orderBy: { commissionPaidUntil: { sort: 'asc', nulls: 'first' } },
      take: COMMISSION_BATCH,
    });
    let paid = 0;
    for (const referral of open) {
      const end = commissionEnd(referral.createdAt, config);
      const until = now < end ? now : end;
      const from = referral.commissionPaidUntil ?? referral.createdAt;
      if (from >= until) continue;
      await this.prisma.transaction(async (tx) => {
        const sums = await tx.spin.groupBy({
          by: ['currency'],
          where: {
            userId: referral.referredId,
            createdAt: { gt: from, lte: until },
            price: { gt: 0 },
          },
          _sum: { price: true },
        });
        const postings: Posting[] = [];
        for (const row of sums) {
          const due = ((row._sum.price ?? 0n) * BigInt(shareBp)) / 10_000n;
          const amount = await this.capped(tx, referral, row.currency, due, until, config);
          if (amount <= 0n) continue;
          const wallet = await tx.wallet.findUnique({
            where: { userId_currency: { userId: referral.referrerId, currency: row.currency } },
          });
          if (!wallet) continue;
          postings.push({
            account: { type: LedgerAccountType.wallet, id: wallet.id },
            delta: amount,
            reason: LedgerReason.referral,
            ref: { type: COMMISSION_REF, id: referral.id },
          });
        }
        if (postings.length > 0) {
          await this.ledger.post(tx, postings, { seasonId });
          paid += postings.length;
        }
        await tx.referral.update({
          where: { id: referral.id },
          data: { commissionPaidUntil: until },
        });
      });
    }
    return { referrals: open.length, paid };
  }

  /**
   * D-119: what may still be paid out of `due` under the caps: per referred player over the whole
   * window and per referrer per UTC day. The rest is not carried over.
   */
  private async capped(
    tx: Tx,
    referral: { id: string; referrerId: string },
    currency: string,
    due: bigint,
    until: Date,
    config: GameConfig,
  ): Promise<bigint> {
    const caps = config.referral.commission;
    const perReferral = BigInt(caps.capPerReferral[currency as Currency]);
    const perDay = BigInt(caps.dailyCapPerReferrer[currency as Currency]);
    const dayStart = new Date(until);
    dayStart.setUTCHours(0, 0, 0, 0);
    const paid = (where: Prisma.LedgerEntryWhereInput) =>
      tx.ledgerEntry
        .aggregate({
          where: {
            userId: referral.referrerId,
            reason: LedgerReason.referral,
            refType: COMMISSION_REF,
            currency,
            ...where,
          },
          _sum: { delta: true },
        })
        .then((r) => r._sum.delta ?? 0n);
    // Sequential: queries of one interactive transaction share its connection.
    const fromReferral = await paid({ refId: referral.id });
    const today = await paid({ createdAt: { gte: dayStart } });
    const left = [due, perReferral - fromReferral, perDay - today].reduce((a, b) =>
      b < a ? b : a,
    );
    return left > 0n ? left : 0n;
  }
}
