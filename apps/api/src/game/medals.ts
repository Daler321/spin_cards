import { type GameConfig, PINNED_MEDALS_MAX } from '@spincards/shared';
import type { PrismaService } from '../prisma/prisma.service.js';

const RARITY_TTL_MS = 10 * 60_000;

export interface MedalRarity {
  /** Players who have each achievement. */
  holders: Map<string, number>;
  players: number;
}

let cached: { at: number; value: MedalRarity } | null = null;

/** How many players have each achievement; cached for a few minutes (D-137). */
export async function medalRarity(prisma: PrismaService, now = Date.now()): Promise<MedalRarity> {
  if (cached && now - cached.at < RARITY_TTL_MS) return cached.value;
  const [rows, players] = await Promise.all([
    prisma.$queryRaw<{ id: string; holders: bigint }[]>`
      SELECT achievement_id AS id, count(DISTINCT user_id)::bigint AS holders
      FROM user_achievements GROUP BY achievement_id`,
    prisma.user.count(),
  ]);
  const value = { holders: new Map(rows.map((r) => [r.id, Number(r.holders)])), players };
  cached = { at: now, value };
  return value;
}

/**
 * The rarest of `earned` first (fewest holders); on ties the harder one — the bigger reward, then
 * the later one in the config.
 */
export function rarestFirst(earned: string[], rarity: MedalRarity, config: GameConfig): string[] {
  const order = new Map(config.achievements.map((a, i) => [a.id, i]));
  const weight = new Map(
    config.achievements.map((a) => [a.id, (a.reward.money?.RUB ?? 0) + (a.reward.exp ?? 0)]),
  );
  return earned
    .filter((id) => order.has(id))
    .sort(
      (a, b) =>
        (rarity.holders.get(a) ?? 0) - (rarity.holders.get(b) ?? 0) ||
        (weight.get(b) ?? 0) - (weight.get(a) ?? 0) ||
        (order.get(b) ?? 0) - (order.get(a) ?? 0),
    );
}

/** What each player shows in the rating: their chosen earned medals, else the rarest earned. */
export async function shownMedals(
  prisma: PrismaService,
  config: GameConfig,
  userIds: string[],
): Promise<Map<string, { ids: string[]; chosen: boolean }>> {
  const result = new Map<string, { ids: string[]; chosen: boolean }>();
  if (userIds.length === 0) return result;
  const [rows, users, rarity] = await Promise.all([
    prisma.userAchievement.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, achievementId: true },
    }),
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, pinnedMedals: true },
    }),
    medalRarity(prisma),
  ]);
  const earned = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = earned.get(row.userId) ?? new Set<string>();
    set.add(row.achievementId);
    earned.set(row.userId, set);
  }
  const known = new Set(config.achievements.map((a) => a.id));
  for (const user of users) {
    const mine = earned.get(user.id) ?? new Set<string>();
    const pinned = user.pinnedMedals
      .filter((id) => mine.has(id) && known.has(id))
      .slice(0, PINNED_MEDALS_MAX);
    result.set(
      user.id,
      pinned.length > 0
        ? { ids: pinned, chosen: true }
        : {
            ids: rarestFirst([...mine], rarity, config).slice(0, PINNED_MEDALS_MAX),
            chosen: false,
          },
    );
  }
  return result;
}

/** Icons for medal ids (unknown ids are skipped). */
export function medalIcons(ids: string[], config: GameConfig): string[] {
  return ids.flatMap((id) => {
    const def = config.achievements.find((a) => a.id === id);
    return def ? [def.icon] : [];
  });
}
