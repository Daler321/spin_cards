import type { Rng } from './ports.js';

/** 10 000 basis points = 100% = ×1.0. */
export const BP = 10_000;

/** floor(a × b / c) for non-negative integers without losing precision above 2^53. */
export function mulDivFloor(a: number, b: number, c: number): number {
  return Number((BigInt(a) * BigInt(b)) / BigInt(c));
}

/** Picks a key with probability proportional to its integer weight. */
export function pickWeighted<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, weight] of entries) total += weight;
  if (total <= 0) throw new RangeError('pickWeighted: total weight must be positive');

  let roll = rng.int(0, total);
  for (const [key, weight] of entries) {
    if (roll < weight) return key;
    roll -= weight;
  }
  /* c8 ignore next */
  throw new Error('pickWeighted: unreachable');
}

/** True with probability chanceBp / 10 000. */
export function rollChance(rng: Rng, chanceBp: number): boolean {
  return chanceBp > 0 && rng.int(0, BP) < chanceBp;
}
