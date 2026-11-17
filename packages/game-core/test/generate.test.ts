import { PATTERN_IDS } from '@spincards/shared';
import { describe, expect, it } from 'vitest';
import {
  buildNumber,
  createSeededRng,
  findPatterns,
  generateNumber,
  NumberSpaceExhaustedError,
  passesLuhn,
  patternTargetWeights,
  toDigits,
} from '../src/index.js';
import { alwaysFree, config, digitsOf, scriptedRng } from './helpers.js';

const CELL = { bankId: 'ruby', tier: 'rare' } as const;

const cfg = config();

describe('generateNumber invariants', () => {
  it('always starts with 9, has 16 digits, fails Luhn and contains its target', async () => {
    const rng = createSeededRng(1);
    for (let i = 0; i < 20_000; i++) {
      const built = await generateNumber(rng, alwaysFree, cfg, 0, CELL);
      expect(built.number).toMatch(/^9\d{15}$/);
      expect(passesLuhn(built.digits)).toBe(false);
      expect(built.patterns).toEqual(findPatterns(toDigits(built.number), cfg.patterns.byId));
      if (built.target) expect(built.patterns.map((p) => p.id)).toContain(built.target);
    }
  });
});

describe('buildNumber', () => {
  it.each(PATTERN_IDS)('places %s', (id) => {
    const rng = createSeededRng(id.length);
    for (let i = 0; i < 200; i++) {
      const built = buildNumber(rng, id, cfg);
      expect(built?.patterns.map((p) => p.id)).toContain(id);
      expect(built?.number.startsWith('9')).toBe(true);
    }
  });

  it('builds a plain number without a target', () => {
    const built = buildNumber(createSeededRng(3), null, cfg);
    expect(built?.target).toBeNull();
  });

  it('gives up when every candidate passes Luhn', () => {
    // 9000 0000 0000 0001 is Luhn-valid; this rng produces it on every try.
    const luhnValid = scriptedRng([...Array<number>(14).fill(0), 1]);
    expect(buildNumber(luhnValid, null, cfg)).toBeNull();
  });
});

describe('uniqueness', () => {
  it('checks the bank and tier the card will have (D-123)', async () => {
    const custom = config();
    // Only full duplicates: such a number always ends up Mythic.
    for (const id of Object.keys(custom.patterns.byId) as (keyof typeof custom.patterns.byId)[])
      custom.patterns.byId[id].weight = id === 'full_duplicate' ? 1 : 0;
    custom.patterns.noPatternWeight = 0;
    const cells: { bankId: string; tier: string }[] = [];
    const checker = {
      isNumberFree: (_n: string, cell: { bankId: string; tier: string }) => {
        cells.push(cell);
        return Promise.resolve(true);
      },
    };
    await generateNumber(createSeededRng(3), checker, custom, 0, CELL);
    expect(cells[0]).toEqual({ bankId: 'ruby', tier: 'mythic' });
  });

  it('makes full duplicates of any digit after the 9, never one passing Luhn (D-148)', async () => {
    const custom = config();
    for (const id of Object.keys(custom.patterns.byId) as (keyof typeof custom.patterns.byId)[])
      custom.patterns.byId[id].weight = id === 'full_duplicate' ? 1 : 0;
    custom.patterns.noPatternWeight = 0;
    const free = { isNumberFree: () => Promise.resolve(true) };
    const rng = createSeededRng(11);
    const repeated = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const built = await generateNumber(rng, free, custom, 0, CELL);
      expect(built.number[0]).toBe('9');
      expect(new Set(built.number.slice(1)).size).toBe(1);
      expect(built.patterns.map((p) => p.id)).toEqual(['full_duplicate']);
      expect(passesLuhn(digitsOf(built.number))).toBe(false);
      repeated.add(built.number[1]!);
    }
    expect(repeated).toEqual(new Set(['0', '1', '2', '3', '4', '5', '6', '8', '9']));
  });

  it('retries until the checker accepts a number', async () => {
    let calls = 0;
    const checker = { isNumberFree: () => Promise.resolve(++calls > 3) };
    await generateNumber(createSeededRng(5), checker, cfg, 0, CELL);
    expect(calls).toBe(4);
  });

  it('falls back to plain numbers after maxAttempts failures', async () => {
    const custom = config();
    custom.patterns.noPatternWeight = 0; // every attempt targets a pattern…
    let calls = 0;
    const checker = {
      isNumberFree: () => Promise.resolve(++calls > custom.numberGeneration.maxAttempts),
    };
    const built = await generateNumber(createSeededRng(6), checker, custom, 0, CELL);
    expect(built.target).toBeNull(); // …until the fallback kicks in
    expect(calls).toBe(custom.numberGeneration.maxAttempts + 1);
  });

  it('throws when no free number is found', async () => {
    const taken = { isNumberFree: () => Promise.resolve(false) };
    await expect(generateNumber(createSeededRng(7), taken, cfg, 0, CELL)).rejects.toBeInstanceOf(
      NumberSpaceExhaustedError,
    );
  });
});

describe('patternTargetWeights', () => {
  const sumPatterns = (w: Record<string, number>) =>
    PATTERN_IDS.reduce((sum, id) => sum + (w[id] ?? 0), 0);

  it('keeps config weights without luck', () => {
    const w = patternTargetWeights(cfg, 0);
    expect(w.none).toBe(cfg.patterns.noPatternWeight * 10_000);
    expect(w.quad).toBe(cfg.patterns.byId.quad.weight * 10_000);
  });

  it('raises pattern weights by the card luck bonus', () => {
    const w = patternTargetWeights(cfg, 1000);
    expect(w.quad).toBe(cfg.patterns.byId.quad.weight * 11_000);
    expect(w.none).toBe(cfg.patterns.noPatternWeight * 10_000);
  });

  it('caps the added pattern weight', () => {
    const base = sumPatterns(patternTargetWeights(cfg, 0));
    const boosted = sumPatterns(patternTargetWeights(cfg, 1_000_000));
    const cap = 1 + cfg.luck.boostCapBp / 10_000;
    expect(boosted).toBeLessThanOrEqual(base * cap);
    expect(boosted).toBeGreaterThan(base * (cap - 0.01));
  });
});
