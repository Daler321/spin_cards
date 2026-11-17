import {
  CARD_BLOCK_LENGTH,
  CARD_NUMBER_LENGTH,
  CARD_NUMBER_PREFIX_DIGIT,
  type GameConfig,
  PATTERN_IDS,
  type PatternId,
  TAIL_PATTERNS,
} from '@spincards/shared';
import { capBoost } from '../luck/boost.js';
import { BP, mulDivFloor, pickWeighted } from '../math.js';
import type { Rng, UniquenessChecker, NumberCell } from '../ports.js';
import { type Digits, fromDigits } from './digits.js';
import { passesLuhn } from './luhn.js';
import { findPatterns, type PatternMatch } from './patterns.js';

const NONE = 'none';
type Target = PatternId | typeof NONE;

/** Weight scale so that boosts below 1 bp of a weight are not lost to rounding. */
const SCALE = BP;
/** Placement retries before giving up on a target (each try succeeds with p > 0.5). */
const MAX_PLACEMENT_TRIES = 64;

/**
 * Pattern target weights. A paying card's luck bonus multiplies every pattern weight (not "none"),
 * limited by the common boost cap.
 */
export function patternTargetWeights(
  config: GameConfig,
  luckBonusBp: number,
): Record<Target, number> {
  const base = {} as Record<Target, number>;
  base[NONE] = config.patterns.noPatternWeight * SCALE;
  for (const id of PATTERN_IDS) base[id] = config.patterns.byId[id].weight * SCALE;

  const boosted = { ...base };
  for (const id of PATTERN_IDS) boosted[id] = mulDivFloor(base[id], BP + luckBonusBp, BP);
  return capBoost(base, boosted, PATTERN_IDS, config.luck.boostCapBp);
}

export function pickPatternTarget(rng: Rng, weights: Record<Target, number>): PatternId | null {
  const target = pickWeighted(rng, Object.entries(weights) as [Target, number][]);
  return target === NONE ? null : target;
}

export interface BuiltNumber {
  number: string;
  digits: Digits;
  patterns: PatternMatch[];
  /** Pattern the generator aimed for; null for a plain random number. */
  target: PatternId | null;
}

/**
 * Builds a number that starts with 9, fails the Luhn check and contains the target pattern.
 * Remaining digits are uniformly random, so extra patterns may appear naturally; they count too.
 * Returns null when the target could not be placed (e.g. impossible with the leading 9).
 */
export function buildNumber(
  rng: Rng,
  target: PatternId | null,
  config: GameConfig,
): BuiltNumber | null {
  for (let i = 0; i < MAX_PLACEMENT_TRIES; i++) {
    const digits = randomDigits(rng);
    if (target) placePattern(rng, digits, target);
    if (passesLuhn(digits)) continue;
    const patterns = findPatterns(digits, config.patterns.byId);
    if (target && !patterns.some((p) => p.id === target)) continue;
    return { number: fromDigits(digits), digits, patterns, target };
  }
  return null;
}

export class NumberSpaceExhaustedError extends Error {
  constructor() {
    super('could not generate a unique card number');
  }
}

/**
 * TZ 5.6 step 5: pick a pattern by weight, build the number and check uniqueness. After
 * `maxAttempts` failures the pattern is dropped and plain numbers are tried instead.
 */
export async function generateNumber(
  rng: Rng,
  uniqueness: UniquenessChecker,
  config: GameConfig,
  luckBonusBp: number,
  cell: NumberCell,
): Promise<BuiltNumber> {
  const { maxAttempts } = config.numberGeneration;
  const weights = patternTargetWeights(config, luckBonusBp);

  for (let attempt = 0; attempt < maxAttempts * 2; attempt++) {
    const target = attempt < maxAttempts ? pickPatternTarget(rng, weights) : null;
    const built = buildNumber(rng, target, config);
    if (!built) continue;
    // A full duplicate makes the card Mythic, so it must be unique among Mythic cards.
    const finalCell = built.patterns.some((p) => p.id === 'full_duplicate')
      ? { ...cell, tier: 'mythic' as const }
      : cell;
    if (await uniqueness.isNumberFree(built.number, finalCell)) return built;
  }
  throw new NumberSpaceExhaustedError();
}

function randomDigits(rng: Rng): Digits {
  const digits = new Array<number>(CARD_NUMBER_LENGTH);
  digits[0] = CARD_NUMBER_PREFIX_DIGIT;
  for (let i = 1; i < CARD_NUMBER_LENGTH; i++) digits[i] = rng.int(0, 10);
  return digits;
}

function placePattern(rng: Rng, digits: Digits, target: PatternId): void {
  switch (target) {
    case 'full_duplicate':
      // D-148: the 9, then 15 equal digits of any value (one that passes Luhn is retried).
      digits.fill(rng.int(0, 10), 1);
      return;
    case 'quad': {
      const start = randomBlockStart(rng);
      const digit = start === 0 ? CARD_NUMBER_PREFIX_DIGIT : rng.int(0, 10);
      digits.fill(digit, start, start + CARD_BLOCK_LENGTH);
      return;
    }
    case 'radar': {
      const start = randomBlockStart(rng);
      const outer = start === 0 ? CARD_NUMBER_PREFIX_DIGIT : rng.int(0, 10);
      const inner = (outer + rng.int(1, 10)) % 10;
      writeDigits(digits, start, [outer, inner, inner, outer]);
      return;
    }
    case 'block_ladder':
      placeLadder(rng, digits, CARD_BLOCK_LENGTH, randomBlockStart(rng));
      return;
    case 'tail_7777':
    case 'tail_0001':
    case 'tail_1337':
    case 'tail_6666':
    case 'tail_9999':
      writeDigits(
        digits,
        CARD_NUMBER_LENGTH - CARD_BLOCK_LENGTH,
        Array.from(TAIL_PATTERNS[target], Number),
      );
      return;
    default: {
      const length = Number(target.slice('long_ladder_'.length));
      placeLadder(rng, digits, length, rng.int(0, CARD_NUMBER_LENGTH - length + 1));
    }
  }
}

/** Writes a run of consecutive digits; at index 0 only a descending run from 9 is possible. */
function placeLadder(rng: Rng, digits: Digits, length: number, start: number): void {
  const ascending = start !== 0 && rng.int(0, 2) === 0;
  const first =
    start === 0
      ? CARD_NUMBER_PREFIX_DIGIT
      : ascending
        ? rng.int(0, 10 - length + 1)
        : rng.int(length - 1, 10);
  const step = ascending ? 1 : -1;
  writeDigits(
    digits,
    start,
    Array.from({ length }, (_, i) => first + i * step),
  );
}

function randomBlockStart(rng: Rng): number {
  return rng.int(0, CARD_NUMBER_LENGTH / CARD_BLOCK_LENGTH) * CARD_BLOCK_LENGTH;
}

function writeDigits(digits: Digits, start: number, values: readonly number[]): void {
  values.forEach((value, i) => (digits[start + i] = value));
}
