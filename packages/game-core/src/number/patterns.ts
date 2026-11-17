import {
  CARD_BLOCK_LENGTH,
  CARD_NUMBER_LENGTH,
  type GameConfig,
  LONG_LADDER_MIN,
  longLadderId,
  type PatternId,
  TAIL_PATTERNS,
  type TailPatternId,
} from '@spincards/shared';

export interface PatternMatch {
  id: PatternId;
  /** Index of the first digit covered by the pattern. */
  start: number;
  length: number;
}

type PatternTable = GameConfig['patterns']['byId'];

interface Run {
  start: number;
  length: number;
}

const TAIL_START = CARD_NUMBER_LENGTH - CARD_BLOCK_LENGTH;
/** Tail value (last four digits as an integer) -> tail pattern id. */
const TAIL_BY_VALUE = new Map<number, TailPatternId>(
  (Object.entries(TAIL_PATTERNS) as [TailPatternId, string][]).map(([id, value]) => [
    Number(value),
    id,
  ]),
);

/**
 * Finds every pattern in a card number (TZ 4.6):
 * - a full duplicate supersedes everything else;
 * - long ladders are maximal runs (step +1 or -1, across blocks); a block ladder lying inside one
 *   is not counted again;
 * - each block yields at most one block pattern (quad, block ladder or radar);
 * - tails are mutually exclusive and compete with the last block's pattern: the higher multiplier
 *   wins (the tail on a tie), so 7777 is a tail, not a tail plus a quad.
 *
 * Hot path (near-miss calls it ~135 times per spin), so it avoids intermediate allocations.
 */
export function findPatterns(digits: readonly number[], table: PatternTable): PatternMatch[] {
  if (isFullDuplicate(digits)) {
    return [{ id: 'full_duplicate', start: 0, length: CARD_NUMBER_LENGTH }];
  }

  const ladders = longLadderRuns(digits);
  const matches: PatternMatch[] = [];
  for (const run of ladders) {
    matches.push({ id: longLadderId(run.length), start: run.start, length: run.length });
  }

  for (let start = 0; start < TAIL_START; start += CARD_BLOCK_LENGTH) {
    const id = blockPatternAt(digits, start, ladders);
    if (id) matches.push({ id, start, length: CARD_BLOCK_LENGTH });
  }

  const blockId = blockPatternAt(digits, TAIL_START, ladders);
  const tailId = TAIL_BY_VALUE.get(
    (digits[12] ?? 0) * 1000 + (digits[13] ?? 0) * 100 + (digits[14] ?? 0) * 10 + (digits[15] ?? 0),
  );
  const lastId =
    tailId && blockId
      ? table[tailId].multBp >= table[blockId].multBp
        ? tailId
        : blockId
      : (tailId ?? blockId);
  if (lastId) matches.push({ id: lastId, start: TAIL_START, length: CARD_BLOCK_LENGTH });

  if (matches.length > 1) matches.sort((a, b) => a.start - b.start || a.length - b.length);
  return matches;
}

/**
 * D-148: the leading 9 is fixed by the rules, so a full duplicate is the 9 followed by 15 equal
 * digits (9555 5555 5555 5555, and 9999 9999 9999 9999).
 */
function isFullDuplicate(digits: readonly number[]): boolean {
  const repeated = digits[1];
  for (let i = 2; i < digits.length; i++) if (digits[i] !== repeated) return false;
  return true;
}

/** Maximal ascending or descending runs of consecutive digits of length >= LONG_LADDER_MIN. */
export function longLadderRuns(digits: readonly number[]): Run[] {
  const runs: Run[] = [];
  let start = 0;
  let step = 0;
  for (let i = 1; i <= digits.length; i++) {
    const diff = i < digits.length ? (digits[i] ?? 0) - (digits[i - 1] ?? 0) : 0;
    const unit = diff === 1 || diff === -1 ? diff : 0;
    if (unit !== 0 && unit === step) continue;
    if (step !== 0 && i - start >= LONG_LADDER_MIN) runs.push({ start, length: i - start });
    // A new run starts at the previous digit, so 54345 yields 543 and 345 sharing the turning 3.
    start = unit === 0 ? i : i - 1;
    step = unit;
  }
  return runs;
}

function blockPatternAt(
  digits: readonly number[],
  start: number,
  longLadders: readonly Run[],
): PatternId | null {
  const a = digits[start] ?? 0;
  const b = digits[start + 1] ?? 0;
  const c = digits[start + 2] ?? 0;
  const d = digits[start + 3] ?? 0;
  if (a === b && b === c && c === d) return 'quad';

  const step = b - a;
  if ((step === 1 || step === -1) && c - b === step && d - c === step) {
    for (const run of longLadders) {
      if (run.start <= start && start + CARD_BLOCK_LENGTH <= run.start + run.length) return null;
    }
    return 'block_ladder';
  }

  if (a === d && b === c) return 'radar';
  return null;
}
