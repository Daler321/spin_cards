import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../src/index.js';

describe('createSeededRng', () => {
  it('is deterministic for the same seed', () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = Array.from({ length: 50 }, () => a.int(0, 1000));
    const seqB = Array.from({ length: 50 }, () => b.int(0, 1000));
    expect(seqA).toEqual(seqB);
  });

  it('differs between seeds', () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    expect(Array.from({ length: 10 }, () => a.int(0, 1e6))).not.toEqual(
      Array.from({ length: 10 }, () => b.int(0, 1e6)),
    );
  });

  it('stays within [min, max) and covers the range', () => {
    const rng = createSeededRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const v = rng.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(9);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('rejects invalid ranges', () => {
    const rng = createSeededRng(0);
    expect(() => rng.int(5, 5)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
  });
});
