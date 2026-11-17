import { CARD_NUMBER_LENGTH, type GameConfig, type PatternId } from '@spincards/shared';
import { findPatterns, type PatternMatch } from './number/patterns.js';

export interface NearMiss {
  /** Pattern the number would have had with one different digit. */
  patternId: PatternId;
  /** Index (0..15) of the digit that differs. */
  position: number;
  /** Digit that would have completed the pattern. */
  digit: number;
}

/**
 * TZ 4.8: an honest hint computed from the number that actually dropped. It never influences
 * generation. A near miss is a configured pattern that one changed digit (never the leading 9)
 * would create and that covers that digit; the most valuable one is reported.
 */
export function findNearMiss(
  digits: readonly number[],
  current: readonly PatternMatch[],
  config: GameConfig,
): NearMiss | null {
  const eligible = new Set(config.nearMiss.patternIds);
  if (eligible.size === 0) return null;

  const table = config.patterns.byId;
  const isCurrent = (match: PatternMatch) =>
    current.some((p) => p.id === match.id && p.start === match.start);
  const work = [...digits];
  let best: (NearMiss & { multBp: number }) | null = null;

  for (let position = 1; position < CARD_NUMBER_LENGTH; position++) {
    const original = work[position] ?? 0;
    for (let digit = 0; digit <= 9; digit++) {
      if (digit === original) continue;
      work[position] = digit;
      for (const match of findPatterns(work, table)) {
        if (position < match.start || position >= match.start + match.length) continue;
        if (!eligible.has(match.id) || isCurrent(match)) continue;
        const multBp = table[match.id].multBp;
        if (!best || multBp > best.multBp) best = { patternId: match.id, position, digit, multBp };
      }
    }
    work[position] = original;
  }
  return best && { patternId: best.patternId, position: best.position, digit: best.digit };
}
