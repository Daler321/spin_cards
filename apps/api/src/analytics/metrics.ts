/** Pure helpers of the daily metrics (TZ 15.1). */

export interface MetricRow {
  metric: string;
  dimension: string;
  value: bigint;
}

export function median(values: readonly bigint[]): bigint {
  if (values.length === 0) return 0n;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as bigint)
    : ((sorted[mid - 1] as bigint) + (sorted[mid] as bigint)) / 2n;
}

/** Share of the total held by the richest `topBp` of holders, in basis points. */
export function topShareBp(values: readonly bigint[], topBp = 100): bigint {
  const total = values.reduce((sum, v) => sum + v, 0n);
  if (total === 0n || values.length === 0) return 0n;
  const count = Math.max(1, Math.ceil((values.length * topBp) / 10_000));
  const top = [...values]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, count)
    .reduce((sum, v) => sum + v, 0n);
  return (top * 10_000n) / total;
}

/** Emission and burn per currency from the day's net ledger flow per (currency, reason). */
export function emissionAndBurn(
  flows: readonly { currency: string; reason: string; net: bigint }[],
): MetricRow[] {
  const emission = new Map<string, bigint>();
  const burn = new Map<string, bigint>();
  for (const flow of flows) {
    if (flow.net > 0n) emission.set(flow.currency, (emission.get(flow.currency) ?? 0n) + flow.net);
    if (flow.net < 0n) burn.set(flow.currency, (burn.get(flow.currency) ?? 0n) - flow.net);
  }
  return [
    ...[...emission].map(([dimension, value]) => ({ metric: 'emission', dimension, value })),
    ...[...burn].map(([dimension, value]) => ({ metric: 'burn', dimension, value })),
  ];
}

/** Calendar date `days` after `date` (YYYY-MM-DD). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The calendar date of `now` in `timeZone` (YYYY-MM-DD). */
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}
