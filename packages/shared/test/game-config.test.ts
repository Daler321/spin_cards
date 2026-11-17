import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_CONFIG,
  GameConfigSchema,
  longLadderId,
  PATTERN_IDS,
  lifecyclePrices,
  scaleDailyReward,
  tierRank,
} from '../src/index.js';

const clone = () => structuredClone(DEFAULT_GAME_CONFIG);

describe('GameConfigSchema', () => {
  it('accepts the default config', () => {
    expect(GameConfigSchema.parse(DEFAULT_GAME_CONFIG)).toEqual(DEFAULT_GAME_CONFIG);
  });

  it('configures every pattern', () => {
    expect(Object.keys(DEFAULT_GAME_CONFIG.patterns.byId).sort()).toEqual([...PATTERN_IDS].sort());
  });

  it('rejects a pack whose tier weights are all zero', () => {
    const config = clone();
    const pack = config.packs[0];
    if (!pack) throw new Error('no packs');
    pack.tierWeights = { common: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 };
    expect(GameConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects pity thresholds that do not grow with the floor', () => {
    const config = clone();
    const pack = config.packs[0];
    if (!pack) throw new Error('no packs');
    pack.pity = { rare: 40, epic: 8, legendary: null };
    expect(GameConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects inverted ranges, duplicate pack ids and fractional money', () => {
    const inverted = clone();
    inverted.packs[1]!.baseLimit.RUB = { min: 10, max: 5 };
    expect(GameConfigSchema.safeParse(inverted).success).toBe(false);

    const duplicate = clone();
    duplicate.packs[1]!.id = duplicate.packs[0]!.id;
    expect(GameConfigSchema.safeParse(duplicate).success).toBe(false);

    const fractional = clone();
    fractional.packs[1]!.prices.RUB = 99.5;
    expect(GameConfigSchema.safeParse(fractional).success).toBe(false);
  });
});

describe('game constants', () => {
  it('orders tiers', () => {
    expect(tierRank('common')).toBeLessThan(tierRank('rare'));
    expect(tierRank('legendary')).toBeLessThan(tierRank('mythic'));
  });

  it('maps ladder lengths to pattern ids', () => {
    expect(longLadderId(5)).toBe('long_ladder_5');
    expect(longLadderId(10)).toBe('long_ladder_10');
    expect(() => longLadderId(4)).toThrow(RangeError);
    expect(() => longLadderId(11)).toThrow(RangeError);
  });
});

describe('levels', () => {
  it('rejects levels that do not start at 0 or do not grow', () => {
    const shifted = clone();
    shifted.levels[0]!.exp = 10;
    expect(GameConfigSchema.safeParse(shifted).success).toBe(false);

    const flat = clone();
    flat.levels[2]!.exp = flat.levels[1]!.exp;
    expect(GameConfigSchema.safeParse(flat).success).toBe(false);
  });

  it('ships 300 levels with a growing EXP step (D-106)', () => {
    const levels = DEFAULT_GAME_CONFIG.levels;
    expect(levels).toHaveLength(300);
    expect(levels[1]?.exp).toBe(130);
    const steps = levels.slice(1).map((l, i) => l.exp - (levels[i]?.exp ?? 0));
    expect(steps.every((step, i) => i === 0 || step >= (steps[i - 1] ?? 0))).toBe(true);
  });
});

describe('daily rewards by level (D-113)', () => {
  const daily = { levelBonusBp: 400, levelStep: 25 };
  it('grows money by 4% per level and spins every 25 levels', () => {
    const reward = { money: { RUB: 50_000 }, freeSpins: 2, luck: { points: 5, spins: 3 } };
    expect(scaleDailyReward(reward, 1, daily)).toEqual(reward);
    expect(scaleDailyReward(reward, 26, daily)).toEqual({
      money: { RUB: 100_000 },
      freeSpins: 3,
      luck: { points: 5, spins: 4 },
    });
    expect(scaleDailyReward({ guaranteedFloor: 'epic' }, 300, daily)).toEqual({
      guaranteedFloor: 'epic',
    });
  });
});

describe('lifecycle prices by rarity (D-115)', () => {
  const lifecycle = DEFAULT_GAME_CONFIG.lifecycle;
  it('grows geometrically with the tier and with the number rarity, capped', () => {
    expect(lifecyclePrices({ tier: 'common', rarityScore: 0 }, 'RUB', lifecycle)).toEqual({
      extend: 50_000,
      restore: 75_000,
    });
    expect(lifecyclePrices({ tier: 'epic', rarityScore: 0 }, 'RUB', lifecycle).extend).toBe(
      800_000,
    );
    expect(lifecyclePrices({ tier: 'epic', rarityScore: 50 }, 'RUB', lifecycle).extend).toBe(
      1_600_000,
    );
    expect(lifecyclePrices({ tier: 'mythic', rarityScore: 600 }, 'RUB', lifecycle).extend).toBe(
      64_000_000,
    );
  });
});
