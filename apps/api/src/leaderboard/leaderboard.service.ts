import { Inject, Injectable, Logger } from '@nestjs/common';
import { seasonScore } from '@spincards/game-core';
import {
  type LeaderboardEntry,
  type LeaderboardResponse,
  type LeaderboardType,
  LEADERBOARD_TYPES,
} from '@spincards/shared';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { medalIcons, shownMedals } from '../game/medals.js';
import { seasonStandings } from '../game/season-score.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';

export const TOP = 50;
export { LEADERBOARD_TYPES };

/** Changes committed this long before the last sync are scanned again (late commits). */
const SYNC_OVERLAP_MS = 60_000;
const ZADD_CHUNK = 1000;
const SNAPSHOT_KEEP_MS = 7 * 86_400_000;

interface ScoreRow {
  id: string;
  score: bigint;
  /** Hidden by the player or banned: not ranked. */
  excluded: boolean;
}

interface RankedUser {
  userId: string;
  score: number;
  rank: number;
}

/**
 * Leaderboards (TZ 7.3) in Redis sorted sets, one per season and type. Balance: wallets plus
 * balances of live cards in RUB at the current rates (D-084); collection: rarity of live cards.
 * The worker keeps them fresh: every few seconds it re-scores players whose ledger entries or cards
 * changed, every hour it rebuilds them, every 5 minutes it snapshots the top to the database.
 * Reads fall back to SQL while Redis is unavailable or the sets are not built yet.
 */
@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seasons: SeasonService,
    private readonly config: GameConfigService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private setKey(seasonId: string, type: LeaderboardType): string {
    return `${this.env.LEADERBOARD_KEY_PREFIX}:${seasonId}:${type}`;
  }

  /** D-154: when each player reached their current score (ms), for ties: the earlier ranks higher. */
  private reachedKey(seasonId: string, type: LeaderboardType): string {
    return `${this.env.LEADERBOARD_KEY_PREFIX}:${seasonId}:${type}:reached`;
  }

  private builtKey(seasonId: string): string {
    return `${this.env.LEADERBOARD_KEY_PREFIX}:${seasonId}:built`;
  }

  private syncKey(seasonId: string): string {
    return `${this.env.LEADERBOARD_KEY_PREFIX}:${seasonId}:synced`;
  }

  async read(userId: string, type: LeaderboardType): Promise<LeaderboardResponse> {
    const seasonId = await this.seasons.currentSeasonId();
    let ranked: { top: RankedUser[]; me: RankedUser | null } | null = null;
    try {
      ranked = await this.fromRedis(seasonId, type, userId);
    } catch (error) {
      this.logger.warn({ err: error }, 'leaderboard read from Redis failed, using SQL');
    }
    ranked ??= await this.fromSql(type, userId, seasonId);
    const result: LeaderboardResponse = { type, ...(await this.withProfiles(ranked, userId)) };
    if (type === 'season') {
      const [season, { config }] = await Promise.all([
        this.seasons.current(),
        this.config.active(),
      ]);
      result.season = {
        name: season.name,
        endsAt: season.endsAt?.toISOString() ?? null,
        medals: config.seasons.medals.map((m) => ({
          maxRank: m.maxRank,
          icon: config.achievements.find((a) => a.id === m.achievementId)?.icon ?? '🏅',
          achievementId: m.achievementId,
        })),
        carryover: config.seasons.carryover,
      };
    }
    return result;
  }

  /** Re-scores every player and swaps the sets in atomically. */
  async rebuild(): Promise<{ ranked: Record<LeaderboardType, number> }> {
    const seasonId = await this.seasons.currentSeasonId();
    const ranked = { season: 0, balance: 0, collection: 0, album: 0 };
    for (const type of LEADERBOARD_TYPES) {
      const rows = (await this.scores(type, seasonId)).filter((r) => eligible(type, r));
      const key = this.setKey(seasonId, type);
      const reachedKey = this.reachedKey(seasonId, type);
      const tmp = `${key}:tmp`;
      const tmpReached = `${reachedKey}:tmp`;
      await this.redis.del(tmp, tmpReached);
      const now = String(Date.now());
      for (let i = 0; i < rows.length; i += ZADD_CHUNK) {
        const part = rows.slice(i, i + ZADD_CHUNK);
        const ids = part.map((r) => r.id);
        const [before, reached] = await Promise.all([
          this.redis.zmscore(key, ...ids),
          this.redis.hmget(reachedKey, ...ids),
        ]);
        await this.redis.zadd(tmp, ...part.flatMap((r) => [Number(r.score), r.id]));
        // An unchanged score keeps the moment it was reached; a new or changed one starts now.
        const times = part.flatMap((r, j) => {
          const same = before[j] !== null && Number(before[j]) === Number(r.score);
          return [r.id, same && reached[j] ? reached[j] : now];
        });
        await this.redis.hset(tmpReached, ...times);
      }
      if (rows.length > 0) {
        await this.redis.rename(tmp, key);
        await this.redis.rename(tmpReached, reachedKey);
      } else await this.redis.del(key, reachedKey);
      ranked[type] = rows.length;
    }
    // The marker lists the types it built: a release that adds a type rebuilds at once (D-125).
    await this.redis.set(this.builtKey(seasonId), LEADERBOARD_TYPES.join(','));
    return { ranked };
  }

  /** Re-scores players touched since the last sync (ledger entries, card changes). */
  async sync(now = new Date()): Promise<{ users: number }> {
    const seasonId = await this.seasons.currentSeasonId();
    const last = await this.redis.get(this.syncKey(seasonId));
    const built = await this.redis.get(this.builtKey(seasonId));
    if (!last || built !== LEADERBOARD_TYPES.join(',')) {
      await this.rebuild();
      await this.redis.set(this.syncKey(seasonId), now.toISOString());
      return { users: -1 };
    }
    const since = new Date(Date.parse(last) - SYNC_OVERLAP_MS);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT user_id::text AS id FROM ledger_entries
      WHERE created_at >= ${since} AND user_id IS NOT NULL
      UNION
      SELECT DISTINCT owner_id::text FROM cards WHERE updated_at >= ${since} AND owner_id IS NOT NULL`;
    await this.refresh(rows.map((r) => r.id));
    await this.redis.set(this.syncKey(seasonId), now.toISOString());
    return { users: rows.length };
  }

  /** Re-scores these players now (e.g. after hiding from the rating). */
  async refresh(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const seasonId = await this.seasons.currentSeasonId();
    if (!(await this.redis.exists(this.builtKey(seasonId)))) return;
    for (const type of LEADERBOARD_TYPES) {
      const key = this.setKey(seasonId, type);
      const reachedKey = this.reachedKey(seasonId, type);
      const rows = await this.scores(type, seasonId, userIds);
      const before = rows.length > 0 ? await this.redis.zmscore(key, ...rows.map((r) => r.id)) : [];
      const now = String(Date.now());
      const pipeline = this.redis.pipeline();
      const scored = new Set<string>();
      rows.forEach((row, i) => {
        scored.add(row.id);
        if (eligible(type, row)) {
          pipeline.zadd(key, Number(row.score), row.id);
          if (before[i] === null || Number(before[i]) !== Number(row.score))
            pipeline.hset(reachedKey, row.id, now);
        } else {
          pipeline.zrem(key, row.id);
          pipeline.hdel(reachedKey, row.id);
        }
      });
      for (const id of userIds)
        if (!scored.has(id)) {
          pipeline.zrem(key, id);
          pipeline.hdel(reachedKey, id);
        }
      await pipeline.exec();
    }
  }

  /** Stores the current top of each type; old snapshots keep only the first one of each day. */
  async snapshot(now = new Date()): Promise<{ rows: number }> {
    const seasonId = await this.seasons.currentSeasonId();
    let rows = 0;
    for (const type of LEADERBOARD_TYPES) {
      let top: RankedUser[];
      try {
        top =
          (await this.fromRedis(seasonId, type, null))?.top ??
          (await this.fromSql(type, null, seasonId)).top;
      } catch {
        top = (await this.fromSql(type, null, seasonId)).top;
      }
      if (top.length === 0) continue;
      const { count } = await this.prisma.leaderboardSnapshot.createMany({
        data: top.map((entry) => ({
          seasonId,
          type,
          userId: entry.userId,
          score: BigInt(Math.round(entry.score)),
          rank: entry.rank,
          takenAt: now,
        })),
      });
      rows += count;
    }
    // The 00:00–00:05 UTC snapshot is the day's record; the rest expire after a week.
    await this.prisma.$executeRaw`
      DELETE FROM leaderboard_snapshots
      WHERE taken_at < ${new Date(now.getTime() - SNAPSHOT_KEEP_MS)}
        AND NOT (extract(hour FROM taken_at AT TIME ZONE 'UTC') = 0
          AND extract(minute FROM taken_at AT TIME ZONE 'UTC') < 5)`;
    return { rows };
  }

  private async fromRedis(
    seasonId: string,
    type: LeaderboardType,
    userId: string | null,
  ): Promise<{ top: RankedUser[]; me: RankedUser | null } | null> {
    const built = await this.redis.get(this.builtKey(seasonId));
    if (!built?.split(',').includes(type)) return null;
    const key = this.setKey(seasonId, type);
    const reachedKey = this.reachedKey(seasonId, type);
    const flat = await this.redis.zrevrange(key, 0, TOP - 1, 'WITHSCORES');
    const candidates = new Map<string, number>();
    for (let i = 0; i < flat.length; i += 2) candidates.set(flat[i] ?? '', Number(flat[i + 1]));
    // Players tied with the last place shown may still rank above it: take them all in.
    const last = flat.at(-1);
    if (last !== undefined && flat.length >= TOP * 2) {
      const tied = await this.redis.zrangebyscore(key, last, last);
      for (const id of tied) candidates.set(id, Number(last));
    }
    const ordered = await this.orderTies(reachedKey, [...candidates]);
    const top = ordered.slice(0, TOP).map(([id, score], i) => ({ userId: id, score, rank: i + 1 }));

    let me = top.find((e) => e.userId === userId) ?? null;
    if (!me && userId) {
      const raw = await this.redis.zscore(key, userId);
      if (raw !== null) {
        const score = Number(raw);
        const better = await this.redis.zcount(key, `(${raw}`, '+inf');
        const tied = await this.redis.zrangebyscore(key, raw, raw);
        const tiedOrder = await this.orderTies(
          reachedKey,
          tied.map((id): [string, number] => [id, score]),
        );
        me = { userId, score, rank: better + tiedOrder.findIndex(([id]) => id === userId) + 1 };
      }
    }
    return { top, me };
  }

  /**
   * D-154: higher score first; on equal scores the one who reached it earlier, then the older
   * account (uuid v7 ids grow with sign-up time). Every player gets their own place.
   */
  private async orderTies(
    reachedKey: string,
    entries: [string, number][],
  ): Promise<[string, number][]> {
    if (entries.length === 0) return [];
    const reached = await this.redis.hmget(reachedKey, ...entries.map(([id]) => id));
    const at = new Map(
      entries.map(([id], i) => [id, Number(reached[i] ?? Number.MAX_SAFE_INTEGER)]),
    );
    return [...entries].sort(
      ([a, sa], [b, sb]) =>
        sb - sa || (at.get(a) ?? 0) - (at.get(b) ?? 0) || (a < b ? -1 : a > b ? 1 : 0),
    );
  }

  /** D-154: for the season end, when each of these players reached their season score (ms). */
  async seasonReachedAt(seasonId: string, userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const raw = await this.redis
      .hmget(this.reachedKey(seasonId, 'season'), ...userIds)
      .catch(() => userIds.map(() => null));
    const result = new Map<string, number>();
    userIds.forEach((id, i) => {
      if (raw[i]) result.set(id, Number(raw[i]));
    });
    return result;
  }

  private async fromSql(
    type: LeaderboardType,
    userId: string | null,
    seasonId: string,
  ): Promise<{ top: RankedUser[]; me: RankedUser | null }> {
    const rows = (await this.scores(type, seasonId)).filter((r) => eligible(type, r));
    const ranked: RankedUser[] = [];
    // Without Redis there is no "reached at": ties go by account age (D-154).
    rows.forEach((row, i) => {
      ranked.push({ userId: row.id, score: Number(row.score), rank: i + 1 });
    });
    return {
      top: ranked.slice(0, TOP),
      me: userId ? (ranked.find((r) => r.userId === userId) ?? null) : null,
    };
  }

  private async withProfiles(
    ranked: { top: RankedUser[]; me: RankedUser | null },
    userId: string,
  ): Promise<Omit<LeaderboardResponse, 'type'>> {
    const ids = [
      ...new Set([...ranked.top.map((e) => e.userId), ...(ranked.me ? [ranked.me.userId] : [])]),
    ];
    const [users, { config }] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, firstName: true, photoUrl: true, level: true },
      }),
      this.config.active(),
    ]);
    const medals = await shownMedals(this.prisma, config, ids);
    const byId = new Map(users.map((u) => [u.id, u]));
    const toEntry = (e: RankedUser): LeaderboardEntry | null => {
      const user = byId.get(e.userId);
      if (!user) return null;
      return {
        userId: e.userId,
        rank: e.rank,
        firstName: user.firstName,
        photoUrl: user.photoUrl,
        level: user.level,
        score: e.score,
        isMe: e.userId === userId,
        medals: medalIcons(medals.get(e.userId)?.ids ?? [], config),
      };
    };
    return {
      top: ranked.top.map(toEntry).filter((e): e is LeaderboardEntry => e !== null),
      me: ranked.me ? toEntry(ranked.me) : null,
    };
  }

  /** D-132: cards + net worth + level, the same score the season end uses. */
  private async seasonScores(seasonId: string, userIds?: string[]): Promise<ScoreRow[]> {
    const { config } = await this.config.active();
    const rows = await seasonStandings(this.prisma, seasonId, userIds);
    // Standings come oldest first, so a stable sort keeps older players ahead on ties.
    return rows
      .map((row) => ({
        id: row.userId,
        // Players who have not spun this season are not in its rating.
        excluded: row.excluded || !row.played,
        score: BigInt(
          seasonScore(
            {
              cardPoints: Number(row.cardPoints),
              netWorthRub: Number(row.netWorthRub),
              level: row.level,
            },
            config.seasons.score,
          ).total,
        ),
      }))
      .sort((a, b) => (b.score > a.score ? 1 : b.score < a.score ? -1 : 0));
  }

  /** Scores in descending order (ties: older players first); `userIds` limits the scan. */
  private scores(type: LeaderboardType, seasonId: string, userIds?: string[]): Promise<ScoreRow[]> {
    const only = userIds ? Prisma.sql`AND u.id = ANY(${userIds}::uuid[])` : Prisma.empty;
    if (type === 'album') {
      // D-129: the album rating is the rarity of the player's trophies.
      return this.prisma.$queryRaw<ScoreRow[]>`
        SELECT u.id::text, (u.hide_from_leaderboard OR u.is_banned) AS excluded,
          COALESCE(SUM(c.rarity_score), 0)::bigint AS score
        FROM users u
        LEFT JOIN cards c ON c.owner_id = u.id AND c.status = 'trophy'
        WHERE TRUE ${only}
        GROUP BY u.id
        ORDER BY score DESC, u.created_at ASC`;
    }
    if (type === 'season') return this.seasonScores(seasonId, userIds);
    if (type === 'collection') {
      return this.prisma.$queryRaw<ScoreRow[]>`
        SELECT u.id::text, (u.hide_from_leaderboard OR u.is_banned) AS excluded,
          COALESCE(SUM(c.rarity_score), 0)::bigint AS score
        FROM users u
        LEFT JOIN cards c ON c.owner_id = u.id AND c.status IN ('active', 'expired')
        WHERE TRUE ${only}
        GROUP BY u.id
        ORDER BY score DESC, u.created_at ASC`;
    }
    return this.prisma.$queryRaw<ScoreRow[]>`
      WITH rates AS (
        SELECT DISTINCT ON (from_currency) from_currency, rate_nano FROM exchange_rates
        WHERE to_currency = 'RUB' AND valid_from <= now() ORDER BY from_currency, valid_from DESC
      )
      , money AS (
        SELECT user_id, currency, balance FROM wallets
        UNION ALL
        SELECT owner_id, currency, balance FROM cards
        WHERE owner_id IS NOT NULL AND status IN ('active', 'expired')
      )
      SELECT u.id::text,
        -- A season rating: players who have not spun this season (start money only) are left out.
        (u.hide_from_leaderboard OR u.is_banned OR NOT EXISTS (
          SELECT 1 FROM user_season_stats s WHERE s.user_id = u.id AND s.season_id = ${seasonId}::uuid
        )) AS excluded,
        COALESCE(SUM(CASE WHEN m.currency = 'RUB' THEN m.balance
          ELSE m.balance * COALESCE(r.rate_nano, 0) / 1000000000 END), 0)::bigint AS score
      FROM users u
      LEFT JOIN money m ON m.user_id = u.id
      LEFT JOIN rates r ON r.from_currency = m.currency
      WHERE TRUE ${only}
      GROUP BY u.id
      ORDER BY score DESC, u.created_at ASC`;
  }
}

/** Collection and season rank only players with points; balance ranks everyone who played the season. */
function eligible(type: LeaderboardType, row: ScoreRow): boolean {
  return !row.excluded && (type === 'balance' || row.score > 0n);
}
