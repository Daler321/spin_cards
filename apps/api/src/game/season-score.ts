import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService, Tx } from '../prisma/prisma.service.js';

export interface StandingRow {
  userId: string;
  /** Rarity of the cards dropped this season (user_season_stats.points). */
  cardPoints: bigint;
  /** Wallets plus live cards, in RUB minor units at the current rates. */
  netWorthRub: bigint;
  level: number;
  /** Hidden from the rating or banned. */
  excluded: boolean;
  /** Has spun this season (players who did not play are not ranked). */
  played: boolean;
  region: 'RU' | 'US';
}

/**
 * The parts of every player's season score (D-132), or of `userIds` only. The score itself is
 * `seasonScore()` (game-core), so the rating, the season end and the profile all count the same.
 */
export function seasonStandings(
  db: Tx | PrismaService,
  seasonId: string,
  userIds?: string[],
): Promise<StandingRow[]> {
  const only = userIds ? Prisma.sql`AND u.id = ANY(${userIds}::uuid[])` : Prisma.empty;
  return db.$queryRaw<StandingRow[]>`
    WITH rates AS (
      SELECT DISTINCT ON (from_currency) from_currency, rate_nano FROM exchange_rates
      WHERE to_currency = 'RUB' AND valid_from <= now() ORDER BY from_currency, valid_from DESC
    ),
    money AS (
      SELECT user_id, currency, balance FROM wallets
      UNION ALL
      SELECT owner_id, currency, balance FROM cards
      WHERE owner_id IS NOT NULL AND status IN ('active', 'expired')
    ),
    worth AS (
      SELECT m.user_id, SUM(CASE WHEN m.currency = 'RUB' THEN m.balance
        ELSE m.balance * COALESCE(r.rate_nano, 0) / 1000000000 END)::bigint AS rub
      FROM money m LEFT JOIN rates r ON r.from_currency = m.currency
      GROUP BY m.user_id
    )
    SELECT u.id::text AS "userId", COALESCE(s.points, 0)::bigint AS "cardPoints",
      COALESCE(w.rub, 0)::bigint AS "netWorthRub", u.level,
      (u.hide_from_leaderboard OR u.is_banned) AS excluded, u.region,
      (s.user_id IS NOT NULL) AS played
    FROM users u
    LEFT JOIN user_season_stats s ON s.user_id = u.id AND s.season_id = ${seasonId}::uuid
    LEFT JOIN worth w ON w.user_id = u.id
    WHERE TRUE ${only}
    ORDER BY u.created_at ASC`;
}

/** One player's net worth in RUB minor units. */
export async function netWorthRub(db: Tx | PrismaService, userId: string): Promise<number> {
  const [row] = await db.$queryRaw<{ rub: bigint }[]>`
    WITH rates AS (
      SELECT DISTINCT ON (from_currency) from_currency, rate_nano FROM exchange_rates
      WHERE to_currency = 'RUB' AND valid_from <= now() ORDER BY from_currency, valid_from DESC
    ),
    money AS (
      SELECT currency, balance FROM wallets WHERE user_id = ${userId}::uuid
      UNION ALL
      SELECT currency, balance FROM cards
      WHERE owner_id = ${userId}::uuid AND status IN ('active', 'expired')
    )
    SELECT COALESCE(SUM(CASE WHEN m.currency = 'RUB' THEN m.balance
      ELSE m.balance * COALESCE(r.rate_nano, 0) / 1000000000 END), 0)::bigint AS rub
    FROM money m LEFT JOIN rates r ON r.from_currency = m.currency`;
  return Number(row?.rub ?? 0n);
}
