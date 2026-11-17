import { Injectable } from '@nestjs/common';
import type {
  ClaimedNotification,
  ClaimNotificationsResponse,
  GameConfig,
  NotificationKind,
  NotificationResultRequest,
} from '@spincards/shared';
import { EventsService } from '../analytics/events.service.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { CardStatus, OutboxStatus, Prisma, type Region } from '../generated/prisma/client.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { deliveryTime, localDayStart, retryDelayMs } from './schedule.js';

/** A claimed row stays leased this long; if the bot dies mid-send it is retried afterwards. */
const LEASE_MS = 5 * 60_000;
const MAX_CLAIM = 100;

export interface NewNotification {
  userId: string;
  kind: NotificationKind;
  params?: Record<string, string | number>;
  /** One message per event; a second enqueue with the same key is ignored. */
  dedupeKey: string;
  scheduledAt?: Date;
}

interface ClaimRow {
  id: string;
  user_id: string;
  kind: string;
  payload: Prisma.JsonValue;
  created_at: Date;
  broadcast_id: string | null;
  telegram_id: bigint;
  language_code: string | null;
  region: Region;
  notifications_enabled: boolean;
  bot_blocked_at: Date | null;
  is_banned: boolean;
  last_seen_at: Date;
  broadcast_text: string | null;
}

type Decision =
  { action: 'send' } | { action: 'skip'; reason: string } | { action: 'later'; at: Date };

/**
 * Notifications outbox (TZ 14). Producers enqueue rows (deduplicated per event); the bot claims due
 * rows, sends them and reports the outcome. Settings, blocks, quiet hours, the daily cap and stale
 * events are checked at claim time, so a delayed message is re-checked when it is finally due.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly events: EventsService,
  ) {}

  async enqueue(items: NewNotification[], tx: Tx = this.prisma): Promise<number> {
    if (items.length === 0) return 0;
    const { count } = await tx.notificationOutbox.createMany({
      data: items.map((item) => ({
        userId: item.userId,
        kind: item.kind,
        payload: item.params ?? {},
        dedupeKey: item.dedupeKey,
        ...(item.scheduledAt && { scheduledAt: item.scheduledAt }),
      })),
      skipDuplicates: true,
    });
    return count;
  }

  /** `kinds` limits the claim (the bot may deliver only some kinds, e.g. broadcasts in dev). */
  async claim(
    limit: number,
    now = new Date(),
    kinds?: readonly NotificationKind[],
  ): Promise<ClaimNotificationsResponse> {
    const { config } = await this.config.active();
    const items = await this.prisma.transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimRow[]>`
        SELECT o.id::text, o.user_id::text, o.kind, o.payload, o.created_at, o.broadcast_id::text,
          u.telegram_id, u.language_code, u.region, u.notifications_enabled, u.bot_blocked_at,
          u.is_banned, u.last_seen_at, b.text AS broadcast_text
        FROM notifications_outbox o
        JOIN users u ON u.id = o.user_id
        LEFT JOIN broadcasts b ON b.id = o.broadcast_id
        WHERE o.status = 'pending' AND o.scheduled_at <= ${now}
          ${kinds && kinds.length > 0 ? Prisma.sql`AND o.kind = ANY(${[...kinds]}::text[])` : Prisma.empty}
        ORDER BY o.scheduled_at
        LIMIT ${Math.min(Math.max(limit, 1), MAX_CLAIM)}
        FOR UPDATE OF o SKIP LOCKED`;

      const sentToday = await this.sentToday(tx, rows, now, config);
      const claimed: ClaimedNotification[] = [];
      for (const row of rows) {
        const decision = await this.decide(tx, row, now, config, sentToday);
        if (decision.action === 'skip') {
          await tx.notificationOutbox.update({
            where: { id: row.id },
            data: { status: OutboxStatus.skipped, lastError: decision.reason },
          });
        } else if (decision.action === 'later') {
          await tx.notificationOutbox.update({
            where: { id: row.id },
            data: { scheduledAt: decision.at },
          });
        } else {
          await tx.notificationOutbox.update({
            where: { id: row.id },
            data: { scheduledAt: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
          });
          if (row.kind !== 'broadcast')
            sentToday.set(row.user_id, (sentToday.get(row.user_id) ?? 0) + 1);
          claimed.push({
            id: row.id,
            kind: row.kind as NotificationKind,
            telegramId: row.telegram_id.toString(),
            languageCode: row.language_code,
            params: paramsOf(row.payload),
            ...(row.broadcast_text !== null && { text: row.broadcast_text }),
          });
        }
      }
      return claimed;
    });
    return { items, perSecond: config.notifications.perSecond };
  }

  async report(id: string, result: NotificationResultRequest, now = new Date()): Promise<void> {
    const { config } = await this.config.active();
    await this.prisma.transaction(async (tx) => {
      const row = await tx.notificationOutbox.findUnique({ where: { id } });
      if (row?.status !== OutboxStatus.pending) return;
      if (result.outcome === 'sent') {
        await tx.notificationOutbox.update({
          where: { id },
          data: { status: OutboxStatus.sent, sentAt: now, lastError: null },
        });
        return;
      }
      if (result.outcome === 'blocked') {
        await tx.user.update({ where: { id: row.userId }, data: { botBlockedAt: now } });
        await this.events.track([{ userId: row.userId, name: 'bot_blocked' }], tx);
        await tx.notificationOutbox.update({
          where: { id },
          data: { status: OutboxStatus.skipped, lastError: 'bot_blocked' },
        });
        return;
      }
      const error = (result.error ?? 'send_failed').slice(0, 300);
      const final = row.attempts >= config.notifications.maxAttempts;
      await tx.notificationOutbox.update({
        where: { id },
        data: final
          ? { status: OutboxStatus.failed, lastError: error }
          : {
              lastError: error,
              scheduledAt: new Date(
                now.getTime() + retryDelayMs(row.attempts, result.retryAfterSec),
              ),
            },
      });
    });
  }

  /** Game notifications already sent today (local day of each player), for the daily cap. */
  private async sentToday(
    tx: Tx,
    rows: ClaimRow[],
    now: Date,
    config: GameConfig,
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const users = new Map(rows.map((r) => [r.user_id, r.region]));
    for (const [userId, region] of users) {
      const since = localDayStart(now, config.notifications.timezones[region]);
      counts.set(
        userId,
        await tx.notificationOutbox.count({
          where: {
            userId,
            status: OutboxStatus.sent,
            sentAt: { gte: since },
            broadcastId: null,
          },
        }),
      );
    }
    return counts;
  }

  private async decide(
    tx: Tx,
    row: ClaimRow,
    now: Date,
    config: GameConfig,
    sentToday: Map<string, number>,
  ): Promise<Decision> {
    const rules = config.notifications;
    if (row.is_banned) return { action: 'skip', reason: 'banned' };
    if (row.bot_blocked_at) return { action: 'skip', reason: 'bot_blocked' };
    if (!row.notifications_enabled) return { action: 'skip', reason: 'disabled' };

    const stale = await this.staleReason(tx, row);
    if (stale) return { action: 'skip', reason: stale };

    const at = deliveryTime(
      now,
      rules.timezones[row.region],
      rules.quietStartHour,
      rules.quietEndHour,
    );
    if (at > now) return { action: 'later', at };

    // Broadcasts and channel posts are news, not game reminders: no daily cap.
    if (
      row.kind !== 'broadcast' &&
      row.kind !== 'channel_post' &&
      (sentToday.get(row.user_id) ?? 0) >= rules.dailyLimit
    )
      return { action: 'skip', reason: 'daily_limit' };
    return { action: 'send' };
  }

  /** The event behind a delayed message may no longer hold (card gone, player came back). */
  private async staleReason(tx: Tx, row: ClaimRow): Promise<string | null> {
    const params = paramsOf(row.payload);
    if (row.kind === 'card_expiring' && typeof params.cardId === 'string') {
      const card = await tx.card.findUnique({
        where: { id: params.cardId },
        select: { ownerId: true, status: true, heldAt: true },
      });
      if (card?.ownerId !== row.user_id || card.status !== CardStatus.active || !card.heldAt)
        return 'card_gone';
    }
    if (
      (row.kind === 'comeback' || row.kind === 'free_spin_ready') &&
      row.last_seen_at > row.created_at
    )
      return 'player_returned';
    return null;
  }
}

function paramsOf(payload: Prisma.JsonValue): Record<string, string | number> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
  const result: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string' || typeof value === 'number') result[key] = value;
  }
  return result;
}
