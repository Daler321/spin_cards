import { describe, expect, it } from 'vitest';
import {
  cardBalance,
  cardLuckPoints,
  numberLuckPoints,
  cashoutFeeBp,
  cashoutPayout,
  findPatterns,
  numberMultBp,
  rarityScore,
} from '../src/index.js';
import { config, digitsOf } from './helpers.js';

const cfg = config();
const patternsOf = (number: string) => findPatterns(digitsOf(number), cfg.patterns.byId);

describe('numberMultBp', () => {
  it('is ×1 without patterns', () => {
    expect(numberMultBp([], cfg)).toBe(10_000);
  });

  it('adds pattern multipliers up', () => {
    // quad ×2.5 + radar ×2.0
    expect(numberMultBp(patternsOf('9000 1111 4334 3581'), cfg)).toBe(45_000);
    // 4 quads ×2.5
    expect(numberMultBp(patternsOf('9999 1111 2222 3333'), cfg)).toBe(100_000);
  });

  it('caps the total multiplier', () => {
    expect(numberMultBp(patternsOf('9876 5432 1053 1586'), cfg)).toBe(600_000);
    expect(numberMultBp(patternsOf('9999 9999 9999 9999'), cfg)).toBe(600_000);
  });
});

describe('cardBalance', () => {
  it('floors base × design × number in minor units', () => {
    expect(cardBalance(60_000, 15_000, 25_000)).toBe(225_000);
    expect(cardBalance(33_333, 15_000, 10_000)).toBe(49_999);
  });

  it('stays exact beyond 2^53 intermediate products', () => {
    expect(cardBalance(2_960_000, 250_000, 600_000)).toBe(4_440_000_000);
  });
});

describe('rarity and luck', () => {
  it('sums tier and pattern points', () => {
    // epic 8 + tail 7777 40
    expect(rarityScore('epic', patternsOf('9135 2468 0246 7777'), cfg)).toBe(48);
    expect(rarityScore('common', [], cfg)).toBe(1);
  });

  it('gives tier points plus the number points, the number up to its cap (D-147)', () => {
    const tier = (t: 'common' | 'rare' | 'epic' | 'mythic') => cfg.tiers[t].cardLuckPoints;
    const numberCap = cfg.cardLuck.numberCapPoints;
    expect(cardLuckPoints('rare', [], cfg)).toBe(tier('rare'));
    expect(cardLuckPoints('mythic', [], cfg)).toBe(tier('mythic'));
    // A full duplicate fills the number part; a card alone stays below the maximum.
    const best = cardLuckPoints('mythic', patternsOf('9999 9999 9999 9999'), cfg);
    expect(best).toBe(tier('mythic') + numberCap);
    expect(best).toBeLessThan(cfg.luck.maxPoints);
    // tail 7777 = 40 points
    expect(cardLuckPoints('epic', patternsOf('9135 2468 0246 7777'), cfg)).toBe(
      tier('epic') + Math.min(40, numberCap),
    );
    expect(cardLuckPoints('epic', patternsOf('9135 2468 0246 1221'), cfg)).toBe(tier('epic') + 1);
    expect(numberLuckPoints(tier('epic') + 15, 'epic', cfg)).toBe(15);
    expect(cardLuckPoints('common', [], cfg)).toBe(tier('common'));
  });

  it('never gives more than the luck maximum', () => {
    const tight = { ...cfg, luck: { ...cfg.luck, maxPoints: 30 } };
    expect(cardLuckPoints('mythic', patternsOf('9999 9999 9999 9999'), tight)).toBe(30);
  });
});

describe('cash-out', () => {
  it('reduces the fee by level down to the floor', () => {
    expect(cashoutFeeBp(1, cfg)).toBe(1000);
    expect(cashoutFeeBp(5, cfg)).toBe(988);
    expect(cashoutFeeBp(100, cfg)).toBe(703);
    expect(cashoutFeeBp(300, cfg)).toBe(200);
    expect(cashoutFeeBp(0, cfg)).toBe(1000);
  });

  it('pays the balance minus the fee, rounded down', () => {
    expect(cashoutPayout(100_001, 1000)).toBe(90_000);
  });
});
