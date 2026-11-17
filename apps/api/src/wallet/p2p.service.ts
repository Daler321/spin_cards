import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type Currency,
  ErrorCode,
  type P2pRecipient,
  type P2pSendRequest,
  type P2pSendResponse,
} from '@spincards/shared';
import { AppError } from '../common/app-error.js';
import { toApiMoney } from '../common/money.js';
import { FlagsService } from '../game-config/flags.service.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { LedgerAccountType, LedgerReason, type User } from '../generated/prisma/client.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { accountKey, LedgerService } from '../ledger/ledger.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';

const BP = 10_000n;

/** "@Name" or "name" → "name". */
export const normalizeUsername = (input: string) => input.trim().replace(/^@/, '').toLowerCase();

/**
 * Money between players by @username (D-131): from the sender's wallet to the recipient's wallet
 * of the same currency, minus a fee that is burnt. Both must have reached minLevel; sending and
 * receiving are each limited per UTC day.
 */
@Injectable()
export class P2pService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly flags: FlagsService,
    private readonly notifications: NotificationsService,
  ) {}

  async recipient(userId: string, username: string): Promise<P2pRecipient> {
    const user = await this.findByUsername(this.prisma, username);
    if (!user || user.id === userId || user.isBanned)
      throw new AppError(ErrorCode.P2P_RECIPIENT_NOT_FOUND, HttpStatus.NOT_FOUND);
    return {
      userId: user.id,
      username: user.username ?? '',
      firstName: user.firstName,
      photoUrl: user.photoUrl,
      level: user.level,
    };
  }

  async send(userId: string, request: P2pSendRequest): Promise<P2pSendResponse> {
    await this.flags.assertNotMaintenance();
    const { config } = await this.config.active();
    const seasonId = await this.seasons.currentSeasonId();
    const { idempotencyKey, ...payload } = request;
    return this.idempotency.run(
      // "@Name" and "name" are the same request.
      {
        userId,
        key: idempotencyKey,
        route: 'wallet.p2p',
        payload: { ...payload, username: normalizeUsername(payload.username) },
      },
      async (tx) => {
        const target = await this.findByUsername(tx, request.username);
        if (!target || target.id === userId)
          throw new AppError(ErrorCode.P2P_RECIPIENT_NOT_FOUND, HttpStatus.NOT_FOUND);
        // Not lockPlayer (FOR UPDATE): the idempotency row inserted above already holds KEY SHARE on
        // the sender's row, so two players sending to each other would deadlock. Advisory locks on
        // both players, always in the same order, serialise their transfers and limit checks; the
        // ledger still locks the wallets.
        for (const id of [userId, target.id].sort())
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`p2p:${id}`}))`;
        const [sender, recipient] = await Promise.all([
          tx.user.findUniqueOrThrow({ where: { id: userId } }),
          tx.user.findUniqueOrThrow({ where: { id: target.id } }),
        ]);
        if (recipient.isBanned)
          throw new AppError(ErrorCode.P2P_RECIPIENT_NOT_FOUND, HttpStatus.NOT_FOUND);

        const rules = config.p2p;
        if (sender.level < rules.minLevel || recipient.level < rules.minLevel)
          throw new AppError(ErrorCode.P2P_LEVEL_TOO_LOW, HttpStatus.FORBIDDEN);
        const currency = request.currency;
        const amount = BigInt(request.amount);
        if (amount < BigInt(rules.minAmount[currency]))
          throw new AppError(ErrorCode.P2P_BELOW_MINIMUM);
        const fee = (amount * BigInt(rules.feeBp) + BP - 1n) / BP;
        const received = amount - fee;

        const limit = BigInt(rules.dailyLimit[currency]);
        const day = new Date();
        day.setUTCHours(0, 0, 0, 0);
        const [sent, got] = await Promise.all([
          tx.playerTransfer.aggregate({
            where: { fromUserId: sender.id, currency, createdAt: { gte: day } },
            _sum: { amount: true },
          }),
          tx.playerTransfer.aggregate({
            where: { toUserId: recipient.id, currency, createdAt: { gte: day } },
            _sum: { amount: true, fee: true },
          }),
        ]);
        const gotNet = (got._sum.amount ?? 0n) - (got._sum.fee ?? 0n);
        if ((sent._sum.amount ?? 0n) + amount > limit || gotNet + received > limit)
          throw new AppError(ErrorCode.P2P_LIMIT_EXCEEDED, HttpStatus.CONFLICT);

        const [fromWallet, toWallet] = await Promise.all([
          this.wallet(tx, sender, currency),
          this.wallet(tx, recipient, currency),
        ]);
        const transferId = randomUUID();
        const ref = { type: 'p2p', id: transferId };
        const fromRef = { type: LedgerAccountType.wallet, id: fromWallet.id };
        const balances = await this.ledger.post(
          tx,
          [
            { account: fromRef, delta: -amount, reason: LedgerReason.p2p, ref },
            {
              account: { type: LedgerAccountType.wallet, id: toWallet.id },
              delta: received,
              reason: LedgerReason.p2p,
              ref,
            },
          ],
          { seasonId },
        );
        await tx.playerTransfer.create({
          data: {
            id: transferId,
            fromUserId: sender.id,
            toUserId: recipient.id,
            currency,
            amount,
            fee,
          },
        });
        await this.notifications.enqueue(
          [
            {
              userId: recipient.id,
              kind: 'p2p_received',
              params: {
                from: sender.username ? `@${sender.username}` : sender.firstName,
                amount: Number(received),
                currency,
              },
              dedupeKey: `p2p:${transferId}`,
            },
          ],
          tx,
        );
        return {
          transferId,
          amount: toApiMoney(amount),
          fee: toApiMoney(fee),
          received: toApiMoney(received),
          wallet: { currency, balance: toApiMoney(balances.get(accountKey(fromRef)) ?? 0n) },
        };
      },
    );
  }

  private findByUsername(db: Tx | PrismaService, username: string): Promise<User | null> {
    const name = normalizeUsername(username);
    if (!/^[a-z0-9_]{3,32}$/.test(name)) return Promise.resolve(null);
    return db.user.findFirst({ where: { username: { equals: name, mode: 'insensitive' } } });
  }

  private wallet(tx: Tx, user: User, currency: Currency) {
    return tx.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user.id, currency } },
    });
  }
}
