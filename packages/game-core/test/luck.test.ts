import { describe, expect, it } from 'vitest';
import {
  activeLuck,
  luckBoostBp,
  luckPoints,
  consumeBuffs,
  duePityFloor,
  effectiveTierWeights,
  emptyPackCounters,
  isReturningPlayer,
  nextMeter,
  nextSinceFloor,
  type PackCounters,
} from '../src/index.js';
import { weightsFromFloor } from '../src/luck/tier-weights.js';
import { config } from './helpers.js';

const cfg = config();
const basic = cfg.packs.find((p) => p.id === 'basic')!;
const business = cfg.packs.find((p) => p.id === 'business')!;
const S = 10_000;

describe('effectiveTierWeights', () => {
  it('keeps base weights without boosts', () => {
    const w = effectiveTierWeights(basic.tierWeights, { lucky: false, rarePlusBoostBp: 0 }, cfg);
    expect(w).toEqual({
      common: 8500 * S,
      rare: 1200 * S,
      epic: 280 * S,
      legendary: 20 * S,
      mythic: 0,
    });
  });

  it('triples Epic+ on a lucky spin', () => {
    const w = effectiveTierWeights(basic.tierWeights, { lucky: true, rarePlusBoostBp: 0 }, cfg);
    expect(w.epic).toBe(840 * S);
    expect(w.legendary).toBe(60 * S);
    expect(w.rare).toBe(1200 * S);
    expect(w.common).toBe(8500 * S);
  });

  it('raises Rare+ by the card and buff bonus', () => {
    const w = effectiveTierWeights(basic.tierWeights, { lucky: false, rarePlusBoostBp: 1000 }, cfg);
    expect(w.rare).toBe(1320 * S);
    expect(w.epic).toBe(308 * S);
  });

  it('caps the combined boost at boostCapBp of base Rare+', () => {
    const w = effectiveTierWeights(
      business.tierWeights,
      { lucky: true, rarePlusBoostBp: 50_000 },
      cfg,
    );
    const rarePlus = w.rare + w.epic + w.legendary + w.mythic;
    const cap = 1 + cfg.luck.boostCapBp / 10_000;
    expect(rarePlus).toBeLessThanOrEqual(5000 * S * cap);
    expect(rarePlus).toBeGreaterThan(5000 * S * (cap - 0.0001));
    expect(w.common).toBe(5000 * S);
  });

  it('restricts weights to a floor and falls back to the floor tier', () => {
    expect(
      weightsFromFloor({ common: 5, rare: 3, epic: 2, legendary: 0, mythic: 0 }, 'epic'),
    ).toEqual([
      ['epic', 2],
      ['legendary', 0],
      ['mythic', 0],
    ]);
    expect(
      weightsFromFloor({ common: 5, rare: 3, epic: 0, legendary: 0, mythic: 0 }, 'legendary'),
    ).toEqual([['legendary', 1]]);
  });
});

describe('pity', () => {
  const counters = (rare: number, epic: number, legendary: number): PackCounters => ({
    ...emptyPackCounters(),
    sinceFloor: { rare, epic, legendary },
  });

  it('is due on the Nth spin without a hit', () => {
    expect(duePityFloor(business, counters(6, 0, 0))).toBeNull();
    expect(duePityFloor(business, counters(7, 0, 0))).toBe('rare');
    expect(duePityFloor(business, counters(7, 39, 0))).toBe('epic');
    expect(duePityFloor(business, counters(7, 39, 249))).toBe('legendary');
  });

  it('ignores disabled floors', () => {
    expect(duePityFloor(basic, counters(0, 0, 10_000))).toBeNull();
  });

  it('resets the counters a tier satisfies', () => {
    expect(nextSinceFloor({ rare: 5, epic: 20, legendary: 100 }, 'common')).toEqual({
      rare: 6,
      epic: 21,
      legendary: 101,
    });
    expect(nextSinceFloor({ rare: 5, epic: 20, legendary: 100 }, 'epic')).toEqual({
      rare: 0,
      epic: 0,
      legendary: 101,
    });
    expect(nextSinceFloor({ rare: 5, epic: 20, legendary: 100 }, 'mythic')).toEqual({
      rare: 0,
      epic: 0,
      legendary: 0,
    });
  });
});

describe('luck meter', () => {
  const at = (luckMeter: number, badStreak = 0): PackCounters => ({
    ...emptyPackCounters(),
    luckMeter,
    badStreak,
  });

  it('grows by one per spin up to the max', () => {
    expect(nextMeter(at(10), false, false, cfg)).toEqual({ luckMeter: 11, badStreak: 0 });
    expect(nextMeter(at(30), false, false, cfg).luckMeter).toBe(30);
  });

  it('resets after a meter-lucky spin', () => {
    expect(nextMeter(at(30), true, false, cfg).luckMeter).toBe(0);
  });

  it('adds bonus points after a bad streak and restarts it', () => {
    expect(nextMeter(at(10, 4), false, true, cfg)).toEqual({ luckMeter: 11, badStreak: 5 });
    expect(nextMeter(at(10, 5), false, true, cfg)).toEqual({ luckMeter: 16, badStreak: 0 });
    expect(nextMeter(at(28, 5), false, true, cfg)).toEqual({ luckMeter: 30, badStreak: 0 });
  });

  it('breaks the streak on a good card and ignores free spins', () => {
    expect(nextMeter(at(10, 5), false, false, cfg).badStreak).toBe(0);
    expect(nextMeter(at(10, 5), false, null, cfg).badStreak).toBe(5);
  });
});

describe('buffs and return', () => {
  it('adds bonus points, applies the strongest multiplier and consumes spin bonuses only (D-147)', () => {
    const buffs = [
      { points: 10, spinsLeft: 2 },
      { points: 5, spinsLeft: 1 },
      { multiplierBp: 15_000, spinsLeft: null },
      { multiplierBp: 30_000, spinsLeft: null },
    ];
    expect(activeLuck(buffs)).toEqual({ points: 15, multiplierBp: 30_000 });
    // (card 20 + bonus 15) × 3 = 105 → capped at the maximum.
    expect(luckPoints(20, buffs, cfg)).toBe(cfg.luck.maxPoints);
    expect(luckPoints(20, [{ points: 10, spinsLeft: 1 }], cfg)).toBe(30);
    expect(luckPoints(0, [], cfg)).toBe(0);
    expect(luckBoostBp(50, cfg)).toBe(50 * cfg.luck.pointBp);
    expect(consumeBuffs(buffs)).toEqual([
      { points: 10, spinsLeft: 1 },
      { multiplierBp: 15_000, spinsLeft: null },
      { multiplierBp: 30_000, spinsLeft: null },
    ]);
    expect(activeLuck([{ points: 5, spinsLeft: 0 }])).toEqual({ points: 0, multiplierBp: 10_000 });
  });

  it('takes even the weakest card to the maximum with the strongest Stars buff (D-147)', () => {
    const max = Math.max(...cfg.stars.buffs.map((b) => b.multiplierBp));
    expect(
      luckPoints(cfg.tiers.common.cardLuckPoints, [{ multiplierBp: max, spinsLeft: null }], cfg),
    ).toBe(cfg.luck.maxPoints);
  });

  it('detects a return after the configured pause', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    expect(isReturningPlayer(null, now, cfg)).toBe(false);
    expect(isReturningPlayer(new Date('2026-10-09T12:00:01Z'), now, cfg)).toBe(false);
    expect(isReturningPlayer(new Date('2026-10-09T12:00:00Z'), now, cfg)).toBe(true);
  });
});
