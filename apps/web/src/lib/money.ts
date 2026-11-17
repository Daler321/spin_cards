import type { Currency, Region } from '@spincards/shared';

export function regionCurrency(region: Region): Currency {
  return region === 'US' ? 'USD' : 'RUB';
}

/** Parses "1 234,5" / "1234.5" into minor units (2 decimals); null when not a positive amount. */
export function parseMajorToMinor(input: string): number | null {
  const normalized = input.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const minor = Math.round(Number(normalized) * 100);
  return minor > 0 ? minor : null;
}

/** Minor units as an input string ("1000", "10.5"), the inverse of parseMajorToMinor. */
export function minorToInput(minor: number): string {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

/** Quick amount steps per currency, in minor units (UI only, not economy). */
export const AMOUNT_STEPS: Record<string, number[]> = {
  RUB: [100_000, 1_000_000, 5_000_000],
  USD: [1_000, 10_000, 50_000],
};

/** A step button adds to the current amount (1 000 → 2 000 → 3 000), never above the maximum. */
export function addStep(current: number | null, step: number, max: number): number {
  return Math.min((current ?? 0) + step, max);
}

/** A mini-game bet (D-169): the parsed amount when it lies in [min, max], else null. */
export function validBet(input: string, min: number, max: number): number | null {
  const bet = parseMajorToMinor(input);
  return bet !== null && bet >= min && bet <= max ? bet : null;
}
