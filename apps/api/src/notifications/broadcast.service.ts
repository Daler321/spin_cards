import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';

const DAY_MS = 86_400_000;

export const BroadcastSchema = z
  .object({
    text: z.string().trim().min(1).max(4096),
    segment: z.enum(['all', 'active', 'inactive']),
    /** Activity window for active/inactive: seen within / not seen for this many days. */
    days: z.number().int().positive().max(365).optional(),
    createdBy: z.string().trim().min(1).max(100),
  })
  .refine((b) => b.segment === 'all' || b.days !== undefined, {
    message: 'days is required for the active and inactive segments',
    path: ['days'],
  });

export type BroadcastRequest = z.infer<typeof BroadcastSchema>;

/**
 * Admin broadcasts (TZ 14): one outbox row per recipient, delivered by the bot at the shared rate
 * limit, with quiet hours and blocks applied like any notification. Players who turned
 * notifications off, blocked the bot or are banned are left out. Logged in audit_log.
 */
@Injectable()
export class BroadcastService {
  constructor(private readonly prisma: PrismaService) {}

  /** D-145: a new post of a listed channel for every reachable player, once per post. */
  channelPost(fromChatId: string, messageId: number): Promise<number> {
    return queueChannelPost(this.prisma, fromChatId, messageId);
  }

  /** How many players a broadcast to this segment would reach now. */
  async count(segment: BroadcastRequest['segment'], days: number | undefined, now = new Date()) {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM users u WHERE ${audience(segment, days, now)}`;
    return Number(rows[0]?.count ?? 0n);
  }

  async create(
    request: BroadcastRequest,
    now = new Date(),
  ): Promise<{ id: string; recipients: number }> {
    const input = BroadcastSchema.parse(request);
    return this.prisma.transaction(async (tx) => {
      const broadcast = await tx.broadcast.create({
        data: {
          text: input.text,
          segment: input.segment,
          segmentDays: input.days ?? null,
          createdBy: input.createdBy,
        },
      });
      const recipients = await tx.$executeRaw`
        INSERT INTO notifications_outbox (id, user_id, kind, payload, status, scheduled_at, broadcast_id)
        SELECT gen_random_uuid(), u.id, 'broadcast', '{}', 'pending', ${now}, ${broadcast.id}::uuid
        FROM users u WHERE ${audience(input.segment, input.days, now)}`;
      await tx.broadcast.update({ where: { id: broadcast.id }, data: { recipients } });
      await tx.auditLog.create({
        data: {
          actorType: 'admin',
          actorId: input.createdBy,
          action: 'broadcast.create',
          targetType: 'broadcast',
          targetId: broadcast.id,
          payload: { segment: input.segment, days: input.days ?? null, recipients },
        },
      });
      return { id: broadcast.id, recipients };
    });
  }
}

/** Queues a channel post for every reachable player, once per post (D-145). */
export async function queueChannelPost(
  prisma: PrismaService | Tx,
  fromChatId: string,
  messageId: number,
  now = new Date(),
): Promise<number> {
  const payload = JSON.stringify({ fromChatId, messageId });
  const dedupe = `channel_post:${fromChatId}:${String(messageId)}:`;
  return prisma.$executeRaw`
    INSERT INTO notifications_outbox (id, user_id, kind, payload, status, scheduled_at, dedupe_key)
    SELECT gen_random_uuid(), u.id, 'channel_post', ${payload}::jsonb, 'pending', ${now},
      ${dedupe} || u.id::text
    FROM users u WHERE ${audience('all', undefined, now)}
    ON CONFLICT (dedupe_key) DO NOTHING`;
}

/** Reachable players of a segment: notifications on, bot not blocked, not banned. */
function audience(segment: BroadcastRequest['segment'], days: number | undefined, now: Date) {
  const since = new Date(now.getTime() - (days ?? 0) * DAY_MS);
  const window =
    segment === 'active'
      ? Prisma.sql`AND u.last_seen_at >= ${since}`
      : segment === 'inactive'
        ? Prisma.sql`AND u.last_seen_at < ${since}`
        : Prisma.empty;
  return Prisma.sql`u.notifications_enabled AND u.bot_blocked_at IS NULL AND NOT u.is_banned ${window}`;
}
