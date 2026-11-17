import type { LuckBuff } from '@spincards/game-core';
import type { BuffView } from '@spincards/shared';
import type { Prisma, UserBuff } from '../generated/prisma/client.js';

/**
 * D-147: bonuses still running: spin-counted ones with spins left, timed ones (Stars multipliers)
 * until they expire. Optionally only those for a pack (old shop buffs belonged to one pack).
 */
export function activeBuffsWhere(
  userId: string,
  now: Date,
  packId?: string,
): Prisma.UserBuffWhereInput {
  return {
    userId,
    AND: [
      { OR: [{ spinsLeft: { gt: 0 } }, { spinsLeft: null, expiresAt: { gt: now } }] },
      ...(packId ? [{ OR: [{ packId: null }, { packId }] }] : []),
    ],
  };
}

/** The game-core view of a bonus row. */
export function toLuckBuff(row: UserBuff): LuckBuff {
  return {
    ...(row.luckPoints !== null && { points: row.luckPoints }),
    ...(row.multiplierBp !== null && { multiplierBp: row.multiplierBp }),
    spinsLeft: row.spinsLeft,
  };
}

export function buffView(row: UserBuff): BuffView {
  return {
    points: row.luckPoints,
    multiplierBp: row.multiplierBp,
    spinsLeft: row.spinsLeft,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    packId: row.packId,
  };
}
