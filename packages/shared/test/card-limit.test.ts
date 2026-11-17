import { describe, expect, it } from 'vitest';
import { cardSpinUsage, chargeCardSpins } from '../src/game/card-limit.js';

const rules = { spins: 250, windowHours: 12 };
const now = new Date('2026-10-15T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

describe('card spin limit (D-121)', () => {
  it('opens a window with the first spin and counts within it', () => {
    expect(cardSpinUsage({ windowStartedAt: null, spinsInWindow: 0 }, rules, now)).toEqual({
      used: 0,
      left: 250,
      resetsAt: null,
    });
    expect(chargeCardSpins({ windowStartedAt: null, spinsInWindow: 0 }, rules, now, 4)).toEqual({
      windowStartedAt: now,
      spinsInWindow: 4,
    });
    const open = { windowStartedAt: hoursAgo(2), spinsInWindow: 248 };
    expect(cardSpinUsage(open, rules, now)).toMatchObject({ used: 248, left: 2 });
    expect(chargeCardSpins(open, rules, now, 2)?.spinsInWindow).toBe(250);
    expect(chargeCardSpins(open, rules, now, 3)).toBeNull();
  });

  it('starts over once the window is 12 hours old', () => {
    const old = { windowStartedAt: hoursAgo(12), spinsInWindow: 250 };
    expect(cardSpinUsage(old, rules, now).left).toBe(250);
    expect(chargeCardSpins(old, rules, now, 1)).toEqual({ windowStartedAt: now, spinsInWindow: 1 });
  });
});
