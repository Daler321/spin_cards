import type { Rng } from '../ports.js';

export interface PlinkoBall {
  /** Bounce per row: 0 = left, 1 = right. The cup index is their sum. */
  path: number[];
  cup: number;
}

/** One ball: each row an even left/right bounce (D-169, pure chance). */
export function dropBall(rng: Rng, rows: number): PlinkoBall {
  const path = Array.from({ length: rows }, () => rng.int(0, 2));
  return { path, cup: path.reduce((sum, step) => sum + step, 0) };
}

/** Exact average return (bp) of a board: binomial chance of each cup × its multiplier. */
export function plinkoReturnBp(rows: number, multipliersBp: readonly number[]): number {
  let total = 0;
  let ways = 1;
  for (let k = 0; k <= rows; k++) {
    total += ways * (multipliersBp[k] ?? 0);
    ways = (ways * (rows - k)) / (k + 1);
  }
  return Math.round(total / 2 ** rows);
}
