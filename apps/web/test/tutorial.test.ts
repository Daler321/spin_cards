import { describe, expect, it } from 'vitest';
import { TUTORIAL_SPINS, type TutorialState, tutorialStep } from '../src/lib/tutorial';

const base: TutorialState = {
  totalSpins: 0,
  paidPack: false,
  payableCards: 0,
  payingWithCard: false,
  dismissed: new Set(),
};

describe('tutorial hints', () => {
  it('tells a brand-new player to spin', () => {
    expect(tutorialStep(base)).toBe('firstSpin');
  });

  it('suggests keeping cards, then paying with one, then explains luck', () => {
    expect(tutorialStep({ ...base, totalSpins: 1 })).toBe('keepCards');
    expect(tutorialStep({ ...base, totalSpins: 2, paidPack: true, payableCards: 1 })).toBe(
      'payWithCard',
    );
    expect(
      tutorialStep({
        ...base,
        totalSpins: 3,
        paidPack: true,
        payableCards: 1,
        payingWithCard: true,
      }),
    ).toBe('cardLuck');
  });

  it('a closed hint never comes back', () => {
    expect(tutorialStep({ ...base, dismissed: new Set(['firstSpin']) })).toBeNull();
  });

  it('stops after the first spins', () => {
    expect(tutorialStep({ ...base, totalSpins: TUTORIAL_SPINS })).toBeNull();
  });
});
