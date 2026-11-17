/**
 * Delivery timing of bot notifications (TZ 14): quiet hours and the daily cap are counted in the
 * player's local time (timezone of their region). Pure functions of `now`.
 */

const HOUR_MS = 3_600_000;

interface LocalTime {
  hour: number;
  minute: number;
  second: number;
}

function localTime(now: Date, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: part('hour'), minute: part('minute'), second: part('second') };
}

/** Whether the local hour falls into [start, end), the window may wrap midnight (23 → 9). */
export function isQuietHour(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * When a message due `now` may be sent: now, or the end of the quiet window (local `end`:00).
 */
export function deliveryTime(now: Date, timeZone: string, start: number, end: number): Date {
  const local = localTime(now, timeZone);
  if (!isQuietHour(local.hour, start, end)) return now;
  const hoursUntilEnd = (end - local.hour + 24) % 24;
  const sinceHour = (local.minute * 60 + local.second) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() + hoursUntilEnd * HOUR_MS - sinceHour);
}

/** Start of the player's local day containing `now` (for the daily cap). */
export function localDayStart(now: Date, timeZone: string): Date {
  const local = localTime(now, timeZone);
  const sinceMidnight =
    ((local.hour * 60 + local.minute) * 60 + local.second) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - sinceMidnight);
}

/** Retry delay after a failed send: Telegram's retry_after if given, else 30 s doubling. */
export function retryDelayMs(attempts: number, retryAfterSec?: number): number {
  if (retryAfterSec !== undefined) return retryAfterSec * 1000;
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), HOUR_MS);
}
