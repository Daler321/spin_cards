import { type Tier, TIERS } from '@spincards/shared';

/** Delay before the first digit opens: the card shows up and starts flickering first. */
export const REVEAL_LEAD_MS = 500;
/** One digit opens every step. */
export const DIGIT_MS = 150;
/** Near miss or milestone: the last four digits open slower (the honest hint, TZ 4.8). */
export const SLOW_DIGIT_MS = 340;
/** Cards of a multi-spin start one after another. */
export const CARD_STAGGER_MS = 150;

/** When each digit of the number opens, in ms from the start of its card. */
export function digitTimes(digits: number, slow: boolean): number[] {
  const times: number[] = [];
  let t = REVEAL_LEAD_MS;
  for (let i = 0; i < digits; i++) {
    t += slow && i >= digits - 4 ? SLOW_DIGIT_MS : DIGIT_MS;
    times.push(t);
  }
  return times;
}

/** The formatted amount with every digit replaced by a random one: separators and «₽» stay put. */
export function scrambleDigits(text: string, random: () => number): string {
  return text.replace(/\d/g, () => String(Math.floor(random() * 10)));
}

/** Decorative flicker colours: any tier, never the same twice in a row (D-164, not the odds). */
export function randomTiers(steps: number, random: () => number): Tier[] {
  const tiers: Tier[] = [];
  for (let i = 0; i < steps; i++) {
    const previous = tiers.at(-1);
    const options = TIERS.filter((tier) => tier !== previous);
    tiers.push(options[Math.floor(random() * options.length)] ?? 'common');
  }
  return tiers;
}
