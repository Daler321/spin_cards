export interface Distribution {
  mean: number;
  p50: number;
  p99: number;
  max: number;
}

/** Sorts in place. Percentiles use the nearest-rank method. */
export function distribution(values: Float64Array | number[]): Distribution {
  const n = values.length;
  if (n === 0) return { mean: 0, p50: 0, p99: 0, max: 0 };
  const sorted = values instanceof Float64Array ? values.sort() : values.sort((a, b) => a - b);
  let sum = 0;
  for (const value of sorted) sum += value;
  const rank = (q: number) => sorted[Math.min(n - 1, Math.ceil(q * n) - 1)] ?? 0;
  return { mean: sum / n, p50: rank(0.5), p99: rank(0.99), max: sorted[n - 1] ?? 0 };
}

/** Ratio in basis points, rounded down; 0 when the denominator is 0. */
export function ratioBp(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.floor((numerator * 10_000) / denominator);
}
