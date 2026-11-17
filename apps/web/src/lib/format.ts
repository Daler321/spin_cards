import { CARD_BLOCK_LENGTH } from '@spincards/shared';

export const LOCALE = 'ru-RU';
const MINOR_UNITS: Record<string, number> = { RUB: 2, USD: 2 };

/** Money from minor units, e.g. 123456 RUB -> "1 234,56 ₽"; whole amounts drop the decimals. */
export function formatMoney(minor: number, currency: string): string {
  const decimals = MINOR_UNITS[currency] ?? 2;
  const major = minor / 10 ** decimals;
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(major) ? 0 : decimals,
    maximumFractionDigits: decimals,
  }).format(major);
}

/** "9123456789012345" -> ["9123", "4567", "8901", "2345"]. */
export function numberBlocks(number: string): string[] {
  return number.match(new RegExp(`.{1,${CARD_BLOCK_LENGTH}}`, 'g')) ?? [];
}

/** Card expiry as "DD.MM": game cards live days, not years, so month/year would say nothing. */
export function formatExpiry(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit' }).format(
    new Date(iso),
  );
}

export function formatPercentBp(bp: number): string {
  return new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 1 }).format(
    bp / 10_000,
  );
}

/** A multiplier in basis points: 19 400 -> "1,94". */
export function formatMultBp(bp: number): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(bp / 10_000);
}

/** Countdown "1:05:09" / "4:09". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Clock time in the player's locale, e.g. "21:30". */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

/** "₽", "$": the short symbol of a currency in the player's locale. */
export function currencySymbol(currency: string): string {
  return (
    new Intl.NumberFormat(LOCALE, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? currency
  );
}
