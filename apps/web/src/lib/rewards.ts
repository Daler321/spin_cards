import type { Currency, DailyReward, PublicConfigResponse } from '@spincards/shared';
import type { TFunction } from 'i18next';
import { formatMoney } from './format';

/** One-line description of a daily/chest reward in the player's currency. */
export function describeReward(
  t: TFunction,
  reward: Omit<DailyReward, 'guaranteedFloor'> & Partial<DailyReward>,
  currency: Currency,
): string {
  const parts: string[] = [];
  const amount = reward.money?.[currency];
  if (amount) parts.push(t('game:daily.money', { amount: formatMoney(amount, currency) }));
  if (reward.luck)
    parts.push(t('game:daily.luck', { points: reward.luck.points, spins: reward.luck.spins }));
  if (reward.freeSpins) parts.push(t('game:daily.freeSpins', { count: reward.freeSpins }));
  if (reward.guaranteedFloor)
    parts.push(t('game:daily.guaranteedTier', { tier: t(`game:tiers.${reward.guaranteedFloor}`) }));
  if (reward.chest) parts.push(t('game:daily.chest'));
  return parts.join(' · ');
}

/** Same scaling as the server: money rewards grow by rewardLevelBonusBp per level above 1. */
export function scaleMoney(
  amount: number,
  level: number,
  config: Pick<PublicConfigResponse, 'rewardLevelBonusBp'>,
): number {
  return Math.floor(
    (amount * (10_000 + Math.max(0, level - 1) * config.rewardLevelBonusBp)) / 10_000,
  );
}

/** Shows the amount actually credited (already scaled by level on the server). */
export function credited<T extends { money?: Partial<Record<Currency, number>> | undefined }>(
  reward: T,
  money: { currency: string; amount: number } | null,
): T {
  return money ? { ...reward, money: { [money.currency]: money.amount } } : reward;
}
