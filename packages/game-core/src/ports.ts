import type { Region, Tier } from '@spincards/shared';

/**
 * Side-effect boundaries of game-core. The core never touches Math.random, Date or I/O directly;
 * callers inject these (crypto-backed in api, seeded in tests and the simulator).
 */
export interface Rng {
  /** Uniform integer in [min, max), same contract as node:crypto randomInt. */
  int(min: number, max: number): number;
}

export interface Clock {
  now(): Date;
}

/** A number is unique within one bank and tier (D-123): other banks and tiers may repeat it. */
export interface NumberCell {
  bankId: string;
  tier: Tier;
}

export interface UniquenessChecker {
  /**
   * True when no card of this bank and tier holds the number in any status, pooled included.
   * Otherwise a pooled card re-dropped later would collide with a freshly generated twin.
   */
  isNumberFree(number: string, cell: NumberCell): Promise<boolean>;
}

export interface PooledCard {
  id: string;
  number: string;
  bankId: string;
  ownersCount: number;
}

export interface CardPool {
  /** Claims the oldest pooled card of this tier and region, or returns null if there is none. */
  takeOldest(tier: Tier, region: Region): Promise<PooledCard | null>;
}
