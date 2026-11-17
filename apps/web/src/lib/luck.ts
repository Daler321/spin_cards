import type { BuffView } from '@spincards/shared';

export interface LuckPreview {
  /** What the player will spin with, 0..max. */
  total: number;
  card: number;
  bonus: number;
  /** The strongest running Stars multiplier (10 000 = none). */
  multiplierBp: number;
}

/**
 * D-147: the luck shown before spinning, as the server counts it: (card + bonus points) × the
 * strongest running multiplier, at most `max`. Bonuses that ran out are left out.
 */
export function previewLuck(
  cardPoints: number,
  buffs: readonly BuffView[],
  max: number,
  now: number,
  packId: string,
): LuckPreview {
  let bonus = 0;
  let multiplierBp = 10_000;
  for (const b of buffs) {
    // Old shop buffs (before D-147) work on their own pack only, as on the server.
    if (b.packId !== null && b.packId !== packId) continue;
    const running =
      b.spinsLeft === null
        ? b.expiresAt !== null && Date.parse(b.expiresAt) > now
        : b.spinsLeft > 0;
    if (!running) continue;
    bonus += b.points ?? 0;
    multiplierBp = Math.max(multiplierBp, b.multiplierBp ?? 10_000);
  }
  const total = Math.min(max, Math.floor(((cardPoints + bonus) * multiplierBp) / 10_000));
  return { total, card: cardPoints, bonus, multiplierBp };
}

/** "×1,5" */
export function multiplierText(bp: number): string {
  return `×${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(bp / 10_000)}`;
}
