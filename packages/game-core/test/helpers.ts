import { DEFAULT_GAME_CONFIG, type GameConfig } from '@spincards/shared';
import type { CardPool, PooledCard, Rng, UniquenessChecker } from '../src/index.js';
import { toDigits } from '../src/index.js';

export const config = (): GameConfig => structuredClone(DEFAULT_GAME_CONFIG);

/** "9123 4567 …" -> digits. */
export const digitsOf = (number: string) => toDigits(number.replaceAll(' ', ''));

export const alwaysFree: UniquenessChecker = { isNumberFree: () => Promise.resolve(true) };

export const emptyPool: CardPool = { takeOldest: () => Promise.resolve(null) };

export function poolOf(...cards: PooledCard[]): CardPool & { taken: PooledCard[] } {
  const taken: PooledCard[] = [];
  return {
    taken,
    takeOldest: () => {
      const card = cards.shift() ?? null;
      if (card) taken.push(card);
      return Promise.resolve(card);
    },
  };
}

/** Rng returning a scripted sequence (each value clamped into the requested range). */
export function scriptedRng(values: readonly number[]): Rng {
  let i = 0;
  return {
    int(min, max) {
      const value = values[i++ % values.length] ?? 0;
      return Math.min(max - 1, Math.max(min, value));
    },
  };
}
