import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AdminFraudEntry, AdminFraudSignalKind } from '@spincards/shared';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';

const IP_TTL_SEC = 7 * 24 * 3600;
/** IP hash -> player ids seen from it; the sorted set ranks hashes by player count. */
const ipKey = (hash: string) => `fraud:ip:${hash}`;
const IP_SIZES = 'fraud:ip-sizes';
const COMMISSION_REF = 'referral_commission';

/**
 * Antifraud signals for the admin panel (D-119). Nothing is blocked automatically: support looks
 * at the list and bans by hand. IP addresses are never stored: only a keyed hash, in Redis, for a
 * week, to notice many accounts behind one address (mobile networks share IPs, so it is a hint).
 */
@Injectable()
export class AntifraudService {
  private readonly logger = new Logger(AntifraudService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Called on every Telegram login; never fails the login. */
  async recordLogin(userId: string, ip: string): Promise<void> {
    try {
      const hash = createHmac('sha256', this.env.JWT_SECRET)
        .update(`ip:${ip}`)
        .digest('base64url')
        .slice(0, 22);
      const key = ipKey(hash);
      const [, , size] = (await this.redis
        .multi()
        .sadd(key, userId)
        .expire(key, IP_TTL_SEC)
        .scard(key)
        .exec()) ?? [null, null, [null, 0]];
      await this.redis.zadd(IP_SIZES, Number(size?.[1] ?? 0), hash);
    } catch (error) {
      this.logger.warn({ err: error }, 'login ip not recorded');
    }
  }

  /** Players with at least one signal, the strongest first. */
  async suspicious(): Promise<AdminFraudEntry[]> {
    const { config } = await this.config.active();
    const rules = config.antifraud;
    const signals = new Map<string, Map<AdminFraudSignalKind, number>>();
    const add = (userId: string, kind: AdminFraudSignalKind, value: number) => {
      const own = signals.get(userId) ?? new Map<AdminFraudSignalKind, number>();
      own.set(kind, Math.max(own.get(kind) ?? 0, value));
      signals.set(userId, own);
    };

    const fast = await this.prisma.$queryRaw<{ userId: string; n: bigint }[]>`
      SELECT user_id::text AS "userId", count(*) AS n FROM spins
      WHERE created_at > now() - interval '1 hour'
      GROUP BY user_id HAVING count(*) >= ${rules.spinsPerHour}`;
    for (const row of fast) add(row.userId, 'spins', Number(row.n));

    const inviters = await this.prisma.$queryRaw<{ userId: string; n: bigint }[]>`
      SELECT referrer_id::text AS "userId", count(*) AS n FROM referrals
      WHERE created_at > now() - interval '24 hours'
      GROUP BY referrer_id HAVING count(*) >= ${rules.referralsPerDay}`;
    for (const row of inviters) add(row.userId, 'referrals', Number(row.n));

    // D-131: money flowing into one player from many others (twinks feeding a main account).
    const receivers = await this.prisma.$queryRaw<{ userId: string; n: bigint }[]>`
      SELECT to_user_id::text AS "userId", count(DISTINCT from_user_id) AS n FROM player_transfers
      WHERE created_at > now() - interval '24 hours'
      GROUP BY to_user_id HAVING count(DISTINCT from_user_id) >= ${rules.p2pSendersPerDay}`;
    for (const row of receivers) add(row.userId, 'p2pIn', Number(row.n));

    // Referrers whose commission today reached the daily cap in some currency.
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const earned = await this.prisma.ledgerEntry.groupBy({
      by: ['userId', 'currency'],
      where: { reason: 'referral', refType: COMMISSION_REF, createdAt: { gte: day } },
      _sum: { delta: true },
    });
    const caps = config.referral.commission.dailyCapPerReferrer;
    for (const row of earned) {
      const cap = caps[row.currency as keyof typeof caps];
      if (row.userId && (row._sum.delta ?? 0n) >= BigInt(cap)) add(row.userId, 'commissionCap', 1);
    }

    const crowded = await this.redis.zrangebyscore(IP_SIZES, rules.sharedIpUsers, '+inf');
    for (const hash of crowded) {
      const members = await this.redis.smembers(ipKey(hash));
      if (members.length < rules.sharedIpUsers) {
        // The set expired or shrank: keep the ranking honest.
        if (members.length === 0) await this.redis.zrem(IP_SIZES, hash);
        else await this.redis.zadd(IP_SIZES, members.length, hash);
        continue;
      }
      for (const userId of members) add(userId, 'sharedIp', members.length);
    }

    if (signals.size === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...signals.keys()] } },
      select: { id: true, firstName: true, username: true, level: true, isBanned: true },
    });
    return users
      .map((u) => ({
        userId: u.id,
        firstName: u.firstName,
        username: u.username,
        level: u.level,
        isBanned: u.isBanned,
        signals: [...(signals.get(u.id) ?? new Map<AdminFraudSignalKind, number>())].map(
          ([kind, value]) => ({ kind, value }),
        ),
      }))
      .sort((a, b) => b.signals.length - a.signals.length || a.firstName.localeCompare(b.firstName))
      .slice(0, 200);
  }
}
