import { DEFAULT_GAME_CONFIG } from '@spincards/shared';
import { describe, expect, it } from 'vitest';
import { earnedAchievements, seasonCarryover, seasonMedal } from '../src/index.js';

const defs = DEFAULT_GAME_CONFIG.achievements;

describe('achievements (D-133)', () => {
  it('matches cards, patterns and counters', () => {
    expect(earnedAchievements(defs, { cards: [{ tier: 'rare', patterns: [] }] })).toEqual([]);
    expect(
      earnedAchievements(defs, {
        cards: [{ tier: 'mythic', patterns: ['full_duplicate'] }],
      }).sort(),
    ).toEqual(['first_epic', 'first_legendary', 'first_mythic', 'full_duplicate']);
    expect(
      earnedAchievements(defs, { cards: [{ tier: 'common', patterns: ['long_ladder_9'] }] }),
    ).toEqual(['ladder_8']);
    expect(
      earnedAchievements(defs, {
        totalSpins: 10_000,
        level: 50,
        trophies: 5,
        quests: 50,
        netWorthRub: 100_000_000,
      }).sort(),
    ).toEqual(['level_50', 'millionaire', 'quests_50', 'spins_1000', 'spins_10000', 'trophies_5']);
  });

  it('gives medals by rank and a capped carryover', () => {
    const { medals, carryover } = DEFAULT_GAME_CONFIG.seasons;
    expect(seasonMedal(1, medals)).toBe('season_top1');
    expect(seasonMedal(3, medals)).toBe('season_top3');
    expect(seasonMedal(50, medals)).toBe('season_top50');
    expect(seasonMedal(51, medals)).toBeNull();
    expect(seasonCarryover(100, 'RUB', carryover)).toBe(100_000);
    expect(seasonCarryover(10_000_000, 'RUB', carryover)).toBe(carryover.cap.RUB);
  });
});
