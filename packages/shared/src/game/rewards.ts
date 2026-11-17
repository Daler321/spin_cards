import type { GameConfig } from './config-schema.js';

type DailyReward = GameConfig['daily']['rewards'][number];

/**
 * A daily reward at a player level (D-113), shared by the server (credits it) and the Mini App
 * (shows it): money grows by `levelBonusBp` per level above 1; every `levelStep` levels free spins
 * and luck bonus spins grow by one.
 */
export function scaleDailyReward(
  reward: DailyReward,
  level: number,
  daily: Pick<GameConfig['daily'], 'levelBonusBp' | 'levelStep'>,
): DailyReward {
  const above = Math.max(0, level - 1);
  const steps = Math.floor(above / daily.levelStep);
  const factor = 10_000 + above * daily.levelBonusBp;
  return {
    ...reward,
    ...(reward.money && {
      money: Object.fromEntries(
        Object.entries(reward.money).map(([currency, amount]) => [
          currency,
          Math.floor((amount * factor) / 10_000),
        ]),
      ),
    }),
    ...(reward.freeSpins && { freeSpins: reward.freeSpins + steps }),
    ...(reward.luck && { luck: { ...reward.luck, spins: reward.luck.spins + steps } }),
  };
}
