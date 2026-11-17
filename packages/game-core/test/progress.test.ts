import { describe, expect, it } from 'vitest';
import {
  accrueFreeSpins,
  addHours,
  chestLevelConfig,
  chestState,
  claimDaily,
  collectionLevel,
  isWheelAvailable,
  rollWheel,
  scaleRewardMoney,
  wheelAvailableAt,
  spinsUsedAfterOpening,
  createSeededRng,
  rollChestReward,
  type DailyState,
  extensionHours,
  levelForExp,
  nextFreeSpinAt,
  utcDay,
} from '../src/index.js';
import { config } from './helpers.js';

const cfg = config();
const t0 = new Date('2026-10-12T00:00:00Z');

describe('free spins', () => {
  it('accrues one spin per interval up to the cap', () => {
    const state = { available: 0, anchorAt: t0 };
    expect(accrueFreeSpins(state, addHours(t0, 3.9), cfg)).toEqual(state);
    expect(accrueFreeSpins(state, addHours(t0, 4), cfg)).toEqual({
      available: 1,
      anchorAt: addHours(t0, 4),
    });
    expect(accrueFreeSpins(state, addHours(t0, 9), cfg)).toEqual({
      available: 2,
      anchorAt: addHours(t0, 8),
    });
    const now = addHours(t0, 100);
    expect(accrueFreeSpins(state, now, cfg)).toEqual({ available: 3, anchorAt: now });
  });

  it('keeps bonus spins above the cap and pauses accrual', () => {
    const now = addHours(t0, 10);
    expect(accrueFreeSpins({ available: 5, anchorAt: t0 }, now, cfg)).toEqual({
      available: 5,
      anchorAt: now,
    });
  });

  it('tells when the next spin accrues', () => {
    expect(nextFreeSpinAt({ available: 1, anchorAt: t0 }, cfg)).toEqual(addHours(t0, 4));
    expect(nextFreeSpinAt({ available: 3, anchorAt: t0 }, cfg)).toBeNull();
  });
});

describe('levelForExp', () => {
  it('maps EXP to the highest reached level', () => {
    expect(levelForExp(0, cfg)).toBe(1);
    expect(levelForExp(129, cfg)).toBe(1);
    expect(levelForExp(130, cfg)).toBe(2);
    const top = cfg.levels.at(-1)?.exp ?? 0;
    expect(levelForExp(top - 1, cfg)).toBe(299);
    expect(levelForExp(top * 10, cfg)).toBe(300);
  });
});

describe('claimDaily', () => {
  const fresh: DailyState = { streak: 0, lastClaimDay: null, forgivenessUsedDay: null };
  const day = (n: number) => addHours(t0, 24 * n + 13);

  it('starts at day 1 and continues on consecutive days', () => {
    const first = claimDaily(fresh, day(0), cfg);
    expect(first).toMatchObject({ ok: true, day: 1, forgiven: false });
    if (!first.ok) throw new Error('unreachable');
    expect(first.state.lastClaimDay).toEqual(utcDay(day(0)));
    const second = claimDaily(first.state, day(1), cfg);
    expect(second).toMatchObject({ ok: true, day: 2, reward: cfg.daily.rewards[1] });
  });

  it('refuses a second claim on the same UTC day', () => {
    const first = claimDaily(fresh, day(0), cfg);
    if (!first.ok) throw new Error('unreachable');
    expect(claimDaily(first.state, addHours(day(0), 10), cfg)).toEqual({
      ok: false,
      reason: 'already_claimed',
    });
  });

  it('forgives one missed day per window, then resets', () => {
    const state: DailyState = { streak: 3, lastClaimDay: utcDay(day(0)), forgivenessUsedDay: null };
    const forgiven = claimDaily(state, day(2), cfg);
    expect(forgiven).toMatchObject({ ok: true, day: 4, forgiven: true });
    if (!forgiven.ok) throw new Error('unreachable');

    const again = claimDaily({ ...forgiven.state }, day(4), cfg);
    expect(again).toMatchObject({ ok: true, day: 1, forgiven: false });

    const later = claimDaily({ ...forgiven.state, lastClaimDay: utcDay(day(9)) }, day(11), cfg);
    expect(later).toMatchObject({ ok: true, day: 5, forgiven: true });
  });

  it('resets after a longer gap and wraps after the last day', () => {
    expect(
      claimDaily(
        { streak: 5, lastClaimDay: utcDay(day(0)), forgivenessUsedDay: null },
        day(3),
        cfg,
      ),
    ).toMatchObject({ day: 1 });
    const seventh = claimDaily(
      { streak: 6, lastClaimDay: utcDay(day(0)), forgivenessUsedDay: null },
      day(1),
      cfg,
    );
    expect(seventh).toMatchObject({ day: 7, reward: { guaranteedFloor: 'epic' } });
    expect(
      claimDaily(
        { streak: 7, lastClaimDay: utcDay(day(0)), forgivenessUsedDay: null },
        day(1),
        cfg,
      ),
    ).toMatchObject({ day: 1 });
  });
});

describe('card lifecycle', () => {
  it('extends by half of the lifespan', () => {
    expect(extensionHours(72, cfg)).toBe(36);
  });
});

describe('chests', () => {
  it('earns one chest per 30 spins and caps the stock', () => {
    expect(chestState(29, 0, cfg)).toEqual({ available: 0, progress: 29, everySpins: 30 });
    expect(chestState(30, 0, cfg)).toEqual({ available: 1, progress: 0, everySpins: 30 });
    expect(chestState(177, 30, cfg)).toEqual({ available: 4, progress: 27, everySpins: 30 });
    expect(chestState(237, 30, cfg)).toEqual({ available: 5, progress: 27, everySpins: 30 });
    expect(chestState(177, 150, cfg).available).toBe(0);
  });

  it('forfeits chests beyond the cap when one is opened', () => {
    // 237 spins, 30 used: 6 chests earned, 5 kept; opening one forfeits one and uses another.
    expect(spinsUsedAfterOpening(237, 30, cfg)).toBe(90);
    expect(chestState(237, 90, cfg)).toEqual({ available: 4, progress: 27, everySpins: 30 });
    expect(spinsUsedAfterOpening(60, 0, cfg)).toBe(30);
  });

  it('survives a change of the chest period (spins, not chests, are counted)', () => {
    // 2 200 spins, 200 chests opened at one per 10 spins = 2 000 spins used.
    const used = 200 * 10;
    expect(chestState(2200, used, cfg)).toEqual({ available: 5, progress: 20, everySpins: 30 });
    // An extra chest (daily reward) gives a period of spins back.
    expect(chestState(20, -30, cfg).available).toBe(1);
  });

  it('rolls rewards by weight from the chest level table', () => {
    const rng = createSeededRng(3);
    const counts = { money: 0, luck: 0 };
    for (let i = 0; i < 2000; i++) counts[rollChestReward(rng, cfg).luck ? 'luck' : 'money']++;
    expect(counts.luck).toBeGreaterThan(300);
    expect(counts.luck).toBeLessThan(500);
    const top = Array.from({ length: 500 }, () => rollChestReward(rng, cfg, 5));
    expect(top.some((r) => r.guaranteedFloor === 'legendary')).toBe(true);
    expect(chestLevelConfig(99, cfg).level).toBe(1);
  });
});

describe('level scaling, wheel and collection', () => {
  it('scales reward money by +1% per level', () => {
    expect(scaleRewardMoney(100_000, 1, cfg)).toBe(100_000);
    expect(scaleRewardMoney(100_000, 3, cfg)).toBe(102_000);
    expect(scaleRewardMoney(100_000, 300, cfg)).toBe(399_000);
  });

  it('frees the wheel every 4 hours', () => {
    expect(isWheelAvailable(null, t0, cfg)).toBe(true);
    expect(wheelAvailableAt(t0, cfg)).toEqual(addHours(t0, 4));
    expect(isWheelAvailable(t0, addHours(t0, 3.9), cfg)).toBe(false);
    expect(isWheelAvailable(t0, addHours(t0, 4), cfg)).toBe(true);
  });

  it('rolls wheel segments by weight', () => {
    const rng = createSeededRng(9);
    const hits = new Array<number>(cfg.wheel.segments.length).fill(0);
    for (let i = 0; i < 10_000; i++) hits[rollWheel(rng, cfg)]!++;
    expect(hits[0]).toBeGreaterThan(2700); // weight 30 of 100
    expect(hits[7]).toBeLessThan(250); // jackpot, weight 1
  });

  it('maps rarity score to a collection level', () => {
    expect(collectionLevel(0, cfg)).toEqual({ level: 1, nextLevelScore: 25 });
    expect(collectionLevel(80, cfg)).toEqual({ level: 3, nextLevelScore: 150 });
    expect(collectionLevel(9999, cfg)).toEqual({ level: 8, nextLevelScore: null });
  });
});
