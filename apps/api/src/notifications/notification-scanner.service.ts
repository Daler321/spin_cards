import { Injectable, Logger } from '@nestjs/common';
import { GameConfigService } from '../game-config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type NewNotification, NotificationsService } from './notifications.service.js';

/** Rows per producer per run; the rest are picked up by the next run a minute later. */
const BATCH = 1000;
const HOUR_MS = 3_600_000;

interface FreeSpinRow {
  id: string;
  free_spins_anchor_at: Date;
}

interface ExpiringRow {
  id: string;
  owner_id: string;
  number: string;
  expires_at: Date;
}

interface ComebackRow {
  id: string;
  last_seen_at: Date;
}

/**
 * Finds events worth a bot message (TZ 14) and puts them into the outbox, one per event (dedupe
 * key). Runs in the worker every minute; delivery rules are applied when the bot claims them.
 * Referral rewards are enqueued by the referral transaction itself.
 */
@Injectable()
export class NotificationScannerService {
  private readonly logger = new Logger(NotificationScannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(now = new Date()): Promise<{ enqueued: number }> {
    const { config } = await this.config.active();
    const rules = config.notifications;
    const items: NewNotification[] = [];

    // Stored stock is 0 and at least one interval has passed: a free spin is waiting.
    const intervalMs = config.freeSpins.intervalHours * HOUR_MS;
    const freeSpins = await this.prisma.$queryRaw<FreeSpinRow[]>`
      SELECT u.id::text, u.free_spins_anchor_at FROM users u
      WHERE u.free_spins_available = 0
        AND u.free_spins_anchor_at <= ${new Date(now.getTime() - intervalMs)}
        AND u.notifications_enabled AND u.bot_blocked_at IS NULL AND NOT u.is_banned
        AND NOT EXISTS (
          SELECT 1 FROM notifications_outbox o
          WHERE o.dedupe_key = 'free_spin_ready:' || u.id || ':' || (extract(epoch FROM u.free_spins_anchor_at) * 1000)::bigint
        )
      LIMIT ${BATCH}`;
    for (const row of freeSpins) {
      items.push({
        userId: row.id,
        kind: 'free_spin_ready',
        dedupeKey: `free_spin_ready:${row.id}:${String(row.free_spins_anchor_at.getTime())}`,
      });
    }

    // Held cards that burn soon (still active: expired ones are past this warning).
    const expiring = await this.prisma.$queryRaw<ExpiringRow[]>`
      SELECT c.id::text, c.owner_id::text, c.number, c.expires_at FROM cards c
      JOIN users u ON u.id = c.owner_id
      WHERE c.status = 'active' AND c.held_at IS NOT NULL
        AND c.expires_at > ${now}
        AND c.expires_at <= ${new Date(now.getTime() + rules.cardExpiringHours * HOUR_MS)}
        AND u.notifications_enabled AND u.bot_blocked_at IS NULL AND NOT u.is_banned
        AND NOT EXISTS (
          SELECT 1 FROM notifications_outbox o
          WHERE o.dedupe_key = 'card_expiring:' || c.id || ':' || (extract(epoch FROM c.expires_at) * 1000)::bigint
        )
      LIMIT ${BATCH}`;
    for (const row of expiring) {
      items.push({
        userId: row.owner_id,
        kind: 'card_expiring',
        params: {
          cardId: row.id,
          last4: row.number.slice(-4),
          hours: Math.max(1, Math.ceil((row.expires_at.getTime() - now.getTime()) / HOUR_MS)),
        },
        dedupeKey: `card_expiring:${row.id}:${String(row.expires_at.getTime())}`,
      });
    }

    // One reminder per absence: keyed by the last visit it follows.
    const comebacks = await this.prisma.$queryRaw<ComebackRow[]>`
      SELECT u.id::text, u.last_seen_at FROM users u
      WHERE u.last_seen_at <= ${new Date(now.getTime() - rules.comebackAfterHours * HOUR_MS)}
        AND u.notifications_enabled AND u.bot_blocked_at IS NULL AND NOT u.is_banned
        AND NOT EXISTS (
          SELECT 1 FROM notifications_outbox o
          WHERE o.dedupe_key = 'comeback:' || u.id || ':' || (extract(epoch FROM u.last_seen_at) * 1000)::bigint
        )
      LIMIT ${BATCH}`;
    for (const row of comebacks) {
      items.push({
        userId: row.id,
        kind: 'comeback',
        dedupeKey: `comeback:${row.id}:${String(row.last_seen_at.getTime())}`,
      });
    }

    const enqueued = await this.notifications.enqueue(items);
    if (enqueued > 0) this.logger.log({ enqueued }, 'notifications enqueued');
    return { enqueued };
  }
}
