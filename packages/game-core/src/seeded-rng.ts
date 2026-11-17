import type { Rng } from './ports.js';

const UINT32 = 0x1_0000_0000;

/** Deterministic mulberry32 generator for tests and the simulator. Not for production rolls. */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };

  return {
    int(min, max) {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max <= min) {
        throw new RangeError(`invalid range [${min}, ${max})`);
      }
      return min + Math.floor(next() * (max - min));
    },
  };
}
