import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AdminAuditItem,
  type AdminBroadcastItem,
  type AdminBroadcastRequest,
  type AdminFlag,
  type AdminMe,
  type AdminPaymentItem,
  type AdminPoolResponse,
  type AdminSeasonItem,
  type BroadcastSegment,
  ErrorCode,
  type Page,
} from '@spincards/shared';
import { AppError } from '../common/app-error.js';
import { FlagsService } from '../game-config/flags.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { lockPlayer } from '../game/player-lock.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { CardsService } from '../game/cards.service.js';
import {
  CardStatus,
  LedgerReason,
  OutboxStatus,
  PaymentStatus,
  type Prisma,
  SeasonStatus,
} from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { BroadcastService } from '../notifications/broadcast.service.js';
import { TelegramApiService } from '../payments/telegram-api.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { auditAdmin } from './admin-users.service.js';

const PAGE = 50;

/** Broadcasts, pool, flags, audit log, seasons and Stars payments (TZ 15.4). */
@Injectable()
export class AdminOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly broadcasts: BroadcastService,
    private readonly flags: FlagsService,
    private readonly ledger: LedgerService,
    private readonly seasons: SeasonService,
    private readonly telegram: TelegramApiService,
    private readonly cards: CardsService,
    private readonly config: GameConfigService,
  ) {}

  // ─── Broadcasts ──────────────────────────────────────────────────────────

  previewBroadcast(segment: BroadcastSegment, days?: number): Promise<number> {
    return this.broadcasts.count(segment, days);
  }

  async createBroadcast(admin: AdminMe, request: AdminBroadcastRequest) {
    return this.broadcasts.create({
      text: request.text,
      segment: request.segment,
      ...(request.days !== undefined && { days: request.days }),
      createdBy: admin.id,
    });
  }

  async listBroadcasts(): Promise<AdminBroadcastItem[]> {
    const rows = await this.prisma.broadcast.findMany({
      orderBy: { createdAt: 'desc' },
      take: PAGE,
    });
    const counts = await this.prisma.notificationOutbox.groupBy({
      by: ['broadcastId', 'status'],
      where: { broadcastId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });
    const count = (id: string, status: OutboxStatus) =>
      counts.find((c) => c.broadcastId === id && c.status === status)?._count._all ?? 0;
    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      segment: r.segment as BroadcastSegment,
      segmentDays: r.segmentDays,
      recipients: r.recipients,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      sent: count(r.id, OutboxStatus.sent),
      pending: count(r.id, OutboxStatus.pending),
      failed: count(r.id, OutboxStatus.failed) + count(r.id, OutboxStatus.skipped),
    }));
  }

  // ─── Pool, seasons ───────────────────────────────────────────────────────

  async pool(): Promise<AdminPoolResponse> {
    const [byTier, oldest] = await Promise.all([
      this.prisma.card.groupBy({
        by: ['tier', 'region'],
        where: { status: CardStatus.pooled },
        _count: { _all: true },
      }),
      this.prisma.card.findMany({
        where: { status: CardStatus.pooled },
        orderBy: { pooledAt: 'asc' },
        take: 100,
      }),
    ]);
    return {
      total: byTier.reduce((sum, row) => sum + row._count._all, 0),
      byTier: byTier.map((row) => ({ tier: row.tier, region: row.region, count: row._count._all })),
      oldest: oldest.map((c) => ({
        id: c.id,
        number: c.number,
        tier: c.tier,
        region: c.region,
        ownersCount: c.ownersCount,
        pooledAt: c.pooledAt?.toISOString() ?? null,
      })),
    };
  }

  async listSeasons(): Promise<AdminSeasonItem[]> {
    const rows = await this.prisma.season.findMany({ orderBy: { startsAt: 'desc' } });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt?.toISOString() ?? null,
    }));
  }

  /** Moves the end of the active season (D-125); the worker closes it once the date passes. */
  async setSeasonEnd(admin: AdminMe, endsAt: Date, reason: string): Promise<void> {
    if (endsAt.getTime() <= Date.now())
      throw new AppError(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    await this.prisma.transaction(async (tx) => {
      const active = await tx.season.findFirst({ where: { status: SeasonStatus.active } });
      if (!active) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
      await tx.season.update({ where: { id: active.id }, data: { endsAt } });
      await auditAdmin(tx, admin, 'season.end_date', { type: 'season', id: active.id }, reason, {
        from: active.endsAt?.toISOString() ?? null,
        to: endsAt.toISOString(),
      });
    });
    await this.seasons.refresh();
  }

  // ─── Flags, audit ────────────────────────────────────────────────────────

  async listFlags(): Promise<AdminFlag[]> {
    const rows = await this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
    return rows.map((f) => ({
      key: f.key,
      enabled: f.enabled,
      description: f.description,
      updatedAt: f.updatedAt.toISOString(),
      updatedBy: f.updatedBy,
    }));
  }

  async setFlag(admin: AdminMe, key: string, enabled: boolean, reason: string): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      const { count } = await tx.featureFlag.updateMany({
        where: { key },
        data: { enabled, updatedBy: admin.login },
      });
      if (count === 0) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
      await auditAdmin(tx, admin, 'flag.set', { type: 'flag', id: key }, reason, { enabled });
    });
    await this.flags.invalidate();
  }

  async audit(filter: {
    action?: string | undefined;
    cursor?: string | undefined;
  }): Promise<Page<AdminAuditItem>> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(filter.action && { action: { startsWith: filter.action } }),
        ...(filter.cursor && { id: { lt: BigInt(filter.cursor) } }),
      },
      orderBy: { id: 'desc' },
      take: PAGE + 1,
    });
    const page = rows.slice(0, PAGE);
    const adminIds = [
      ...new Set(
        page.filter((r) => r.actorType === 'admin' && r.actorId).map((r) => r.actorId as string),
      ),
    ].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const admins = await this.prisma.adminUser.findMany({
      where: { id: { in: adminIds } },
      select: { id: true, login: true },
    });
    const loginOf = new Map(admins.map((a) => [a.id, a.login]));
    const items = page.map((r) => ({
      id: r.id.toString(),
      actorType: r.actorType,
      actorId: r.actorId,
      actorName: (r.actorId && loginOf.get(r.actorId)) ?? null,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      reason: r.reason,
      payload: r.payload,
      createdAt: r.createdAt.toISOString(),
    }));
    return { items, nextCursor: rows.length > PAGE ? (items.at(-1)?.id ?? null) : null };
  }

  // ─── Stars payments ──────────────────────────────────────────────────────

  async listPayments(status?: string): Promise<AdminPaymentItem[]> {
    const rows = await this.prisma.payment.findMany({
      where: status ? { status: status as PaymentStatus } : {},
      orderBy: { createdAt: 'desc' },
      take: PAGE,
    });
    return rows.map((p) => ({
      id: p.id,
      userId: p.userId,
      productId: p.productId,
      status: p.status,
      starsAmount: p.starsAmount,
      telegramPaymentChargeId: p.telegramPaymentChargeId,
      createdAt: p.createdAt.toISOString(),
      paidAt: p.paidAt?.toISOString() ?? null,
      refundedAt: p.refundedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Refund (TZ 9): the product is taken back first (money through the ledger, never below zero;
   * buff, free spins or holder removed), then Telegram returns the Stars; if Telegram refuses, the
   * whole transaction rolls back. A product the player already spent cannot be refunded (D-100).
   */
  async refund(admin: AdminMe, paymentId: string, reason: string): Promise<void> {
    const seasonId = await this.seasons.currentSeasonId();
    await this.prisma.transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: { user: true, product: true },
      });
      if (!payment) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
      await lockPlayer(tx, payment.userId);
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
      const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (current.status !== PaymentStatus.paid || !current.telegramPaymentChargeId)
        throw new AppError(ErrorCode.PAYMENT_NOT_REFUNDABLE, HttpStatus.CONFLICT);

      const credited = await tx.ledgerEntry.findMany({
        where: { refType: 'payment', refId: payment.id, reason: LedgerReason.stars_purchase },
      });
      if (credited.length > 0) {
        try {
          await this.ledger.post(
            tx,
            credited.map((entry) => ({
              account: { type: entry.accountType, id: entry.accountId },
              delta: -entry.delta,
              reason: LedgerReason.stars_refund,
              ref: { type: 'payment', id: payment.id },
            })),
            { seasonId },
          );
        } catch (error) {
          if (error instanceof AppError && error.code === ErrorCode.INSUFFICIENT_FUNDS)
            throw new AppError(ErrorCode.PAYMENT_NOT_REFUNDABLE, HttpStatus.CONFLICT);
          throw error;
        }
      }
      await this.takeBackGoods(
        tx,
        payment.userId,
        payment.product.kind,
        payment.product.refId,
        payment.product.payload,
      );

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.refunded, refundedAt: new Date() },
      });
      await auditAdmin(tx, admin, 'payment.refund', { type: 'payment', id: payment.id }, reason, {
        stars: payment.starsAmount,
        productId: payment.productId,
      });
      await this.telegram.refundStarPayment(
        payment.user.telegramId.toString(),
        current.telegramPaymentChargeId,
      );
    });
  }

  private async takeBackGoods(
    tx: Prisma.TransactionClient,
    userId: string,
    kind: string,
    refId: string | null,
    payload: Prisma.JsonValue,
  ): Promise<void> {
    const data = (payload ?? {}) as { boostBp?: number; spins?: number; count?: number };
    if (kind === 'buff' && data.boostBp) {
      const buff = await tx.userBuff.findFirst({
        where: {
          userId,
          source: 'stars',
          boostBp: data.boostBp,
          spinsLeft: data.spins ?? { gt: 0 },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!buff) throw new AppError(ErrorCode.PAYMENT_NOT_REFUNDABLE, HttpStatus.CONFLICT);
      await tx.userBuff.update({ where: { id: buff.id }, data: { spinsLeft: 0 } });
    }
    if (kind === 'free_spins' && data.count) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.freeSpinsAvailable < data.count)
        throw new AppError(ErrorCode.PAYMENT_NOT_REFUNDABLE, HttpStatus.CONFLICT);
      await tx.user.update({
        where: { id: userId },
        data: { freeSpinsAvailable: { decrement: data.count } },
      });
    }
    if (kind === 'holder' && refId) {
      const owned = await tx.userHolder.findFirst({
        where: { userId, holderId: refId, source: 'stars' },
      });
      if (!owned) throw new AppError(ErrorCode.PAYMENT_NOT_REFUNDABLE, HttpStatus.CONFLICT);
      await tx.userHolder.delete({ where: { id: owned.id } });
      // The cards kept must still fit the remaining slots.
      const { config } = await this.config.active();
      const held = await tx.card.count({
        where: {
          ownerId: userId,
          status: { in: [CardStatus.active, CardStatus.expired] },
          heldAt: { not: null },
        },
      });
      if (held > (await this.cards.totalSlots(tx, userId, config)))
        throw new AppError(ErrorCode.PAYMENT_NOT_REFUNDABLE, HttpStatus.CONFLICT);
    }
  }
}
