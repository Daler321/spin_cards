import type { AlbumIncomeConfig, Currency, NickBonusConfig, Tier } from '@spincards/shared';

const HOUR = 3_600_000;

/** D-172: what one album income claim pays: every trophy's amount by its tier. */
export function albumIncomeAmount(
  trophies: readonly { tier: Tier }[],
  income: AlbumIncomeConfig,
  currency: Currency,
): number {
  return trophies.reduce((sum, t) => sum + income.perTier[t.tier][currency], 0);
}

/** When the next claim opens after `last`; null: now. Income does not pile up past one claim. */
export function nextClaimAt(last: Date | null, hours: number, now: Date): Date | null {
  if (!last) return null;
  const at = new Date(last.getTime() + hours * HOUR);
  return at > now ? at : null;
}

/** D-173: the tag anywhere in the first or last name, case and spaces around it ignored. */
export function hasNickTag(
  firstName: string,
  lastName: string | null,
  bonus: Pick<NickBonusConfig, 'tag'>,
): boolean {
  const tag = bonus.tag.trim().toLowerCase();
  return `${firstName} ${lastName ?? ''}`.toLowerCase().includes(tag);
}

/** The worker re-checks a name after checkHours. */
export function nickCheckDue(checkedAt: Date | null, bonus: NickBonusConfig, now: Date): boolean {
  return !checkedAt || now.getTime() - checkedAt.getTime() >= bonus.checkHours * HOUR;
}
