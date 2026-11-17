import type { Rng } from '../ports.js';

export const COIN_SIDES = ['heads', 'tails'] as const;
export type CoinSide = (typeof COIN_SIDES)[number];

export function flipCoin(rng: Rng): CoinSide {
  return COIN_SIDES[rng.int(0, 2)] as CoinSide;
}
