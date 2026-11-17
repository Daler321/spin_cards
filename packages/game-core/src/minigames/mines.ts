import { BP } from '../math.js';
import type { Rng } from '../ports.js';
import { shuffle } from './shuffle.js';

/** D-169: one mines board and its money rules (from config.minigames.mines). */
export interface MinesParams {
  cells: number;
  mines: number;
  houseEdgeBp: number;
  bonusBp: number;
}

export interface MinesLayout {
  mines: number[];
  /** The «SpinCards» cell: safe, adds bonusBp to the winnings when opened. */
  bonus: number;
}

/** Places the mines and the bonus cell; decided once, before the first cell is opened. */
export function layMines(rng: Rng, cells: number, mines: number): MinesLayout {
  const order = shuffle(
    rng,
    Array.from({ length: cells }, (_, i) => i),
  );
  return { mines: order.slice(0, mines).sort((a, b) => a - b), bonus: order[mines] as number };
}

/**
 * Multiplier after `opened` safe cells, the bonus found at step `bonusStep` (1-based) or not yet.
 * The ladder is fair before the edge at every step (D-169): while the bonus is hidden a step grows
 * by (left)/(safe left + b) and the find adds ×(1 + b); after it a step grows by left/(safe left).
 * So taking the money at any moment returns 1 − edge on average and stopping right after the
 * bonus gains nothing.
 */
export function minesMultiplierBp(
  params: MinesParams,
  opened: number,
  bonusStep: number | null,
): number {
  const { cells, mines } = params;
  const safe = cells - mines;
  const b = params.bonusBp / BP;
  let mult = 1 - params.houseEdgeBp / BP;
  for (let i = 0; i < opened; i++) {
    const left = cells - i;
    const safeLeft = safe - i;
    const found = bonusStep !== null && bonusStep <= i;
    mult *= found ? left / safeLeft : left / (safeLeft + b);
    if (bonusStep === i + 1) mult *= 1 + b;
  }
  // Rounded down to basis points; the tiny epsilon keeps exact products (e.g. 2.0) from 19 999.
  return Math.floor(mult * BP + 1e-6);
}

/** Chance (bp) that the next opened cell is safe, after `opened` safe cells. */
export function minesSafeChanceBp(cells: number, mines: number, opened: number): number {
  const left = cells - opened;
  return left <= 0 ? 0 : Math.floor(((left - mines) * BP) / left);
}

/**
 * Average return (bp) of taking the money right after `opened` safe cells, with the rounded
 * multipliers. Alive after k cells the bonus is equally likely at any of the safe cells.
 */
export function minesReturnBp(params: MinesParams, opened: number): number {
  const safe = params.cells - params.mines;
  let alive = 1;
  for (let i = 0; i < opened; i++) alive *= (safe - i) / (params.cells - i);
  let payout = ((safe - opened) / safe) * minesMultiplierBp(params, opened, null);
  for (let step = 1; step <= opened; step++)
    payout += minesMultiplierBp(params, opened, step) / safe;
  return Math.round(alive * payout);
}
