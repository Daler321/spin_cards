import {
  type GameConfig,
  type PackConfig,
  type PityFloor,
  PITY_FLOORS,
  type Tier,
  tierRank,
} from '@spincards/shared';
import { BP, mulDivFloor } from '../math.js';

/** Per user and pack (`user_counters`). */
export interface PackCounters {
  /** Luck meter 0..meterMax; at the max the next spin of this pack is "lucky". */
  luckMeter: number;
  /** Spins since the last result at or above each pity floor. */
  sinceFloor: Record<PityFloor, number>;
  /** Consecutive spins whose card was worth less than the pack price. */
  badStreak: number;
}

/**
 * D-147: a luck bonus. Free bonuses add `points` for `spinsLeft` spins; Stars buffs multiply the
 * luck by `multiplierBp` until they expire (the caller passes active ones only: no clock here).
 */
export interface LuckBuff {
  points?: number;
  multiplierBp?: number;
  /** Spins left; null for a buff that lasts a time instead. */
  spinsLeft: number | null;
}

/** Per user, shared by all packs. */
export interface PlayerCounters {
  totalSpins: number;
  /** Set when a player returns after a long pause; consumed by the next free spin. */
  returnLuckyPending: boolean;
  buffs: LuckBuff[];
}

export function emptyPackCounters(): PackCounters {
  return { luckMeter: 0, sinceFloor: { rare: 0, epic: 0, legendary: 0 }, badStreak: 0 };
}

export function emptyPlayerCounters(): PlayerCounters {
  return { totalSpins: 0, returnLuckyPending: false, buffs: [] };
}

/** Highest pity floor due on this spin, or null. */
export function duePityFloor(pack: PackConfig, counters: PackCounters): PityFloor | null {
  let due: PityFloor | null = null;
  for (const floor of PITY_FLOORS) {
    const every = pack.pity[floor];
    if (every !== null && counters.sinceFloor[floor] + 1 >= every) due = floor;
  }
  return due;
}

export function nextSinceFloor(
  since: Readonly<Record<PityFloor, number>>,
  tier: Tier,
): Record<PityFloor, number> {
  const next = { ...since };
  for (const floor of PITY_FLOORS) {
    next[floor] = tierRank(tier) >= tierRank(floor) ? 0 : since[floor] + 1;
  }
  return next;
}

/**
 * Luck meter after a spin: reset after a meter-lucky spin, otherwise +1; a bad streak of
 * `badStreakLength` spins adds `badStreakMeterBonus` points and restarts the streak.
 */
export function nextMeter(
  counters: PackCounters,
  usedMeterLucky: boolean,
  belowPrice: boolean | null,
  config: GameConfig,
): Pick<PackCounters, 'luckMeter' | 'badStreak'> {
  const { meterMax, badStreakLength, badStreakMeterBonus } = config.luck;
  let luckMeter = usedMeterLucky ? 0 : Math.min(meterMax, counters.luckMeter + 1);
  let badStreak =
    belowPrice === null ? counters.badStreak : belowPrice ? counters.badStreak + 1 : 0;
  if (badStreak >= badStreakLength) {
    luckMeter = Math.min(meterMax, luckMeter + badStreakMeterBonus);
    badStreak = 0;
  }
  return { luckMeter, badStreak };
}

const alive = (buff: LuckBuff) => buff.spinsLeft === null || buff.spinsLeft > 0;

/** Bonus points add up; of the multipliers the strongest applies. */
export function activeLuck(buffs: readonly LuckBuff[]): { points: number; multiplierBp: number } {
  let points = 0;
  let multiplierBp = BP;
  for (const buff of buffs.filter(alive)) {
    points += buff.points ?? 0;
    multiplierBp = Math.max(multiplierBp, buff.multiplierBp ?? BP);
  }
  return { points, multiplierBp };
}

/** D-147: the player's luck for a spin: (card + bonus points) × multiplier, at most maxPoints. */
export function luckPoints(
  cardPoints: number,
  buffs: readonly LuckBuff[],
  config: GameConfig,
): number {
  const { points, multiplierBp } = activeLuck(buffs);
  return Math.min(config.luck.maxPoints, mulDivFloor(cardPoints + points, multiplierBp, BP));
}

/** The hidden boost behind the luck points (Rare+ chances and beautiful numbers). */
export function luckBoostBp(points: number, config: GameConfig): number {
  return points * config.luck.pointBp;
}

/** A spin uses up one spin of every spin-counted bonus; timed ones are left to expire. */
export function consumeBuffs(buffs: readonly LuckBuff[]): LuckBuff[] {
  return buffs
    .map((buff) => (buff.spinsLeft === null ? buff : { ...buff, spinsLeft: buff.spinsLeft - 1 }))
    .filter(alive);
}

/** A pause of at least returnAfterHours since the last activity makes the next free spin lucky. */
export function isReturningPlayer(
  lastActivityAt: Date | null,
  now: Date,
  config: GameConfig,
): boolean {
  if (!lastActivityAt) return false;
  return now.getTime() - lastActivityAt.getTime() >= config.luck.returnAfterHours * 3_600_000;
}
