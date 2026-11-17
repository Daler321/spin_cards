import { describe, expect, it } from 'vitest';
import { findNearMiss, findPatterns } from '../src/index.js';
import { config, digitsOf } from './helpers.js';

const cfg = config();
const nearMiss = (number: string, c = cfg) => {
  const digits = digitsOf(number);
  return findNearMiss(digits, findPatterns(digits, c.patterns.byId), c);
};

describe('findNearMiss', () => {
  it('spots an almost-7777 tail', () => {
    expect(nearMiss('9050 5050 5050 7776')).toEqual({
      patternId: 'tail_7777',
      position: 15,
      digit: 7,
    });
  });

  it('spots a ladder 1-7 broken on the 8th digit', () => {
    expect(nearMiss('9123 4567 0505 0505')).toEqual({
      patternId: 'long_ladder_8',
      position: 8,
      digit: 8,
    });
  });

  it('spots three of four equal digits', () => {
    expect(nearMiss('9050 2228 5050 5050')).toEqual({ patternId: 'quad', position: 7, digit: 2 });
  });

  it('returns null when one digit is not enough', () => {
    expect(nearMiss('9050 5050 5050 5050')).toBeNull();
  });

  it('does not report a pattern the number already has', () => {
    expect(nearMiss('9050 5050 5050 7777')).toBeNull();
  });

  it('never changes the leading digit', () => {
    expect(nearMiss('8999 9999 9999 9999')?.patternId).not.toBe('full_duplicate');
  });

  it('is disabled by an empty pattern list', () => {
    const c = config();
    c.nearMiss.patternIds = [];
    expect(nearMiss('9050 5050 5050 7776', c)).toBeNull();
  });
});
