/** Spins a holder card may pay for within a window that opens with its first spin (D-121). */
export interface CardSpinLimitRules {
  spins: number;
  windowHours: number;
}

export interface CardSpinWindow {
  windowStartedAt: Date | string | null;
  spinsInWindow: number;
}

/** Spins used in the current window and when it resets (null: no open window). */
export function cardSpinUsage(
  card: CardSpinWindow,
  rules: CardSpinLimitRules,
  now: Date,
): { used: number; left: number; resetsAt: Date | null } {
  const started = card.windowStartedAt === null ? null : new Date(card.windowStartedAt);
  const resetsAt = started && new Date(started.getTime() + rules.windowHours * 3600_000);
  if (!resetsAt || resetsAt <= now) return { used: 0, left: rules.spins, resetsAt: null };
  const used = Math.min(card.spinsInWindow, rules.spins);
  return { used, left: rules.spins - used, resetsAt };
}

/** The card's window after paying for `count` more spins now, or null if that exceeds the limit. */
export function chargeCardSpins(
  card: CardSpinWindow,
  rules: CardSpinLimitRules,
  now: Date,
  count: number,
): { windowStartedAt: Date; spinsInWindow: number } | null {
  const usage = cardSpinUsage(card, rules, now);
  if (count > usage.left) return null;
  return usage.resetsAt
    ? {
        windowStartedAt: new Date(card.windowStartedAt as Date | string),
        spinsInWindow: usage.used + count,
      }
    : { windowStartedAt: now, spinsInWindow: count };
}
