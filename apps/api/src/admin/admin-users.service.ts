import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AdminAdjustRequest,
  type AdminBuffRequest,
  type AdminMe,
  type AdminUserDetail,
  type AdminUserListItem,
  ErrorCode,
} from '@spincards/shared';
import { activeBuffsWhere, buffView } from '../game/buffs.js';
import { AppError } from '../common/app-error.js';
import { toApiMoney } from '../common/money.js';
import { SeasonService } from '../game-config/season.service.js';
import { lockPlayer } from '../game/player-lock.js';
import {
  LedgerAccountType,
  LedgerReason,
  type Prisma,
  type User,
} from '../generated/prisma/client.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { LeaderboardService } from '../leaderboard/leaderboard.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';

const LIST_LIMIT = 50;
const DETAIL_LEDGER = 100;
const DETAIL_SPINS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Writes an admin action to audit_log (CLAUDE.md: every manual action, with its reason). */
export async function auditAdmin(
  tx: Tx,
  admin: AdminMe,
  action: string,
  target: { type: string; id: string } | null,
  reason: string | null,
  payload: Prisma.InputJsonValue = {},
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorType: 'admin',
      actorId: admin.id,
      action,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      reason,
      payload,
    },
  });
}

/** Players for support (TZ 15.3): search, profile, ban, manual adjustments and buffs. */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly seasons: SeasonService,
    private readonly idempotency: IdempotencyService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  /** By id, Telegram id, @username or a part of the name; newest first. */
  async search(query: string): Promise<AdminUserListItem[]> {
    const q = query.trim();
    const where: Prisma.UserWhereInput =
      q === ''
        ? {}
        : UUID.test(q)
          ? { id: q }
          : /^\d{1,20}$/.test(q)
            ? { telegramId: BigInt(q) }
            : q.startsWith('@')
              ? { username: { equals: q.slice(1), mode: 'insensitive' } }
              : {
                  OR: [
                    { firstName: { contains: q, mode: 'insensitive' } },
                    { username: { contains: q, mode: 'insensitive' } },
                  ],
                };
    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
    });
    return users.map(listItem);
  }

  async detail(userId: string): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { wallets: { orderBy: { currency: 'asc' } } },
    });
    if (!user) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
    const [cards, buffs, ledger, spins, referrals] = await Promise.all([
      this.prisma.card.findMany({
        where: { ownerId: userId },
        orderBy: { issuedAt: 'desc' },
      }),
      this.prisma.userBuff.findMany({ where: activeBuffsWhere(userId, new Date()) }),
      this.prisma.ledgerEntry.findMany({
        where: { userId },
        orderBy: { id: 'desc' },
        take: DETAIL_LEDGER,
      }),
      this.prisma.spin.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: DETAIL_SPINS,
      }),
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        include: { referred: { select: { firstName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      ...listItem(user),
      exp: user.exp,
      totalSpins: user.totalSpins,
      referralCode: user.referralCode,
      referrerId: user.referrerId,
      notificationsEnabled: user.notificationsEnabled,
      hideFromLeaderboard: user.hideFromLeaderboard,
      botBlockedAt: user.botBlockedAt?.toISOString() ?? null,
      experimentGroup: user.experimentGroup,
      wallets: user.wallets.map((w) => ({ currency: w.currency, balance: toApiMoney(w.balance) })),
      cards: cards.map((c) => ({
        id: c.id,
        number: c.number,
        tier: c.tier,
        status: c.status,
        balance: toApiMoney(c.balance),
        currency: c.currency,
        held: c.heldAt !== null,
        expiresAt: c.expiresAt.toISOString(),
      })),
      buffs: buffs.map((b) => ({ ...buffView(b), source: b.source })),
      ledger: ledger.map((e) => ({
        id: e.id.toString(),
        accountType: e.accountType,
        accountId: e.accountId,
        currency: e.currency,
        delta: toApiMoney(e.delta),
        balanceAfter: toApiMoney(e.balanceAfter),
        reason: e.reason,
        createdAt: e.createdAt.toISOString(),
      })),
      spins: spins.map((s) => ({
        id: s.id,
        packId: s.packId,
        price: toApiMoney(s.price),
        currency: s.currency,
        createdAt: s.createdAt.toISOString(),
      })),
      referrals: referrals.map((r) => ({
        id: r.referredId,
        firstName: r.referred.firstName,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async setBanned(admin: AdminMe, userId: string, banned: boolean, reason: string): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId },
        data: { isBanned: banned },
      });
      if (count === 0) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
      await auditAdmin(
        tx,
        admin,
        banned ? 'user.ban' : 'user.unban',
        { type: 'user', id: userId },
        reason,
      );
    });
    await this.leaderboard.refresh([userId]).catch(() => undefined);
  }

  /** Credit or debit a wallet through the ledger (admin_adjust), never below zero. */
  async adjust(
    admin: AdminMe,
    userId: string,
    request: AdminAdjustRequest,
  ): Promise<{ currency: string; balance: number }> {
    const seasonId = await this.seasons.currentSeasonId();
    const { idempotencyKey, ...payload } = request;
    return this.idempotency.run(
      { userId, key: `admin:${idempotencyKey}`, route: 'admin.adjust', payload },
      async (tx) => {
        await lockPlayer(tx, userId);
        const wallet = await tx.wallet.findUnique({
          where: { userId_currency: { userId, currency: request.currency } },
        });
        if (!wallet) throw new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED);
        const balances = await this.ledger.post(
          tx,
          [
            {
              account: { type: LedgerAccountType.wallet, id: wallet.id },
              delta: BigInt(request.amount),
              reason: LedgerReason.admin_adjust,
              ref: { type: 'admin', id: admin.id },
            },
          ],
          { seasonId },
        );
        await auditAdmin(tx, admin, 'user.adjust', { type: 'user', id: userId }, request.reason, {
          currency: request.currency,
          amount: request.amount,
        });
        return {
          currency: wallet.currency,
          balance: toApiMoney(balances.get(`wallet:${wallet.id}`) ?? wallet.balance),
        };
      },
    );
  }

  /** Credit or debit a player's live card through the ledger (admin_adjust), never below zero. */
  async adjustCard(
    admin: AdminMe,
    userId: string,
    cardId: string,
    request: { amount: number; reason: string; idempotencyKey: string },
  ): Promise<{ cardId: string; balance: number }> {
    const seasonId = await this.seasons.currentSeasonId();
    const { idempotencyKey, ...payload } = request;
    return this.idempotency.run(
      {
        userId,
        key: `admin:${idempotencyKey}`,
        route: 'admin.adjust_card',
        payload: { cardId, ...payload },
      },
      async (tx) => {
        await lockPlayer(tx, userId);
        const card = await tx.card.findUnique({ where: { id: cardId } });
        if (card?.ownerId !== userId || (card.status !== 'active' && card.status !== 'expired'))
          throw new AppError(ErrorCode.CARD_NOT_FOUND, HttpStatus.NOT_FOUND);
        const balances = await this.ledger.post(
          tx,
          [
            {
              account: { type: LedgerAccountType.card, id: card.id },
              delta: BigInt(request.amount),
              reason: LedgerReason.admin_adjust,
              ref: { type: 'admin', id: admin.id },
            },
          ],
          { seasonId },
        );
        await auditAdmin(tx, admin, 'card.adjust', { type: 'user', id: userId }, request.reason, {
          cardId,
          currency: card.currency,
          amount: request.amount,
        });
        return { cardId, balance: toApiMoney(balances.get(`card:${card.id}`) ?? card.balance) };
      },
    );
  }

  async grantBuff(admin: AdminMe, userId: string, request: AdminBuffRequest): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
      // D-147: +points of luck for some spins, like a free bonus.
      await tx.userBuff.create({
        data: { userId, luckPoints: request.points, spinsLeft: request.spins, source: 'admin' },
      });
      await auditAdmin(tx, admin, 'user.buff', { type: 'user', id: userId }, request.reason, {
        points: request.points,
        spins: request.spins,
      });
    });
  }
}

function listItem(user: User): AdminUserListItem {
  return {
    id: user.id,
    telegramId: user.telegramId.toString(),
    username: user.username,
    firstName: user.firstName,
    level: user.level,
    region: user.region,
    isBanned: user.isBanned,
    createdAt: user.createdAt.toISOString(),
    lastSeenAt: user.lastSeenAt.toISOString(),
  };
}
