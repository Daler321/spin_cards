import { TIERS } from '@spincards/shared';
import { describe, expect, it } from 'vitest';
import {
  DIGIT_MS,
  digitTimes,
  REVEAL_LEAD_MS,
  randomTiers,
  scrambleDigits,
  SLOW_DIGIT_MS,
} from '../src/lib/reveal';

describe('spin reveal (D-164)', () => {
  it('opens the digits one by one, the last four slower on a near miss', () => {
    const fast = digitTimes(16, false);
    expect(fast).toHaveLength(16);
    expect(fast[0]).toBe(REVEAL_LEAD_MS + DIGIT_MS);
    expect(fast[15]).toBe(REVEAL_LEAD_MS + 16 * DIGIT_MS);
    const slow = digitTimes(16, true);
    expect(slow.slice(0, 12)).toEqual(fast.slice(0, 12));
    expect(slow[15]).toBe(REVEAL_LEAD_MS + 12 * DIGIT_MS + 4 * SLOW_DIGIT_MS);
  });

  it('scrambles only the digits of a formatted amount', () => {
    expect(scrambleDigits('12 345,67 ₽', () => 0.75)).toBe('77 777,77 ₽');
  });

  it('flickers through every tier at random, never one colour twice in a row', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16_807) % 2_147_483_647) - 1) / 2_147_483_646;
    const tiers = randomTiers(500, random);
    expect(new Set(tiers)).toEqual(new Set(TIERS));
    for (let i = 1; i < tiers.length; i++) expect(tiers[i]).not.toBe(tiers[i - 1]);
  });
});
