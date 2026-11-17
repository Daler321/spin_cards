import { type Currency, type GameConfig, type Tier, tierRank, TIERS } from '@spincards/shared';
import { BP, mulDivFloor } from '../math.js';
import { capBoost } from './boost.js';

const RARE_PLUS = TIERS.filter((tier) => tierRank(tier) >= tierRank('rare'));
const EPIC_PLUS = TIERS.filter((tier) => tierRank(tier) >= tierRank('epic'));

/** Weight scale so that small boosts survive integer rounding. */
const SCALE = BP;

export interface TierBoosts {
  /** "Lucky" spin: Epic+ weights are multiplied by luckyEpicPlusMultBp. */
  lucky: boolean;
  /** Sum of card luck bonus, active buffs and the newbie bonus, applied to Rare+ weights. */
  rarePlusBoostBp: number;
  /** Hidden starter luck (D-116): multiplies Rare+ weights after the cap. */
  hiddenBoostBp?: number;
}

/**
 * TZ 5.6 step 2: base -> lucky -> card/buff bonus -> common cap -> normalisation (implicit in the
 * weighted pick). The cap limits added Rare+ weight to boostCapBp of the base Rare+ weight.
 */
export function effectiveTierWeights(
  baseWeights: Readonly<Record<Tier, number>>,
  boosts: TierBoosts,
  config: GameConfig,
): Record<Tier, number> {
  const base = {} as Record<Tier, number>;
  for (const tier of TIERS) base[tier] = baseWeights[tier] * SCALE;

  const boosted = { ...base };
  if (boosts.lucky) {
    for (const tier of EPIC_PLUS) {
      boosted[tier] = mulDivFloor(boosted[tier], config.luck.luckyEpicPlusMultBp, BP);
    }
  }
  for (const tier of RARE_PLUS) {
    boosted[tier] = mulDivFloor(boosted[tier], BP + boosts.rarePlusBoostBp, BP);
  }
  const capped = capBoost(base, boosted, RARE_PLUS, config.luck.boostCapBp);
  const hidden = boosts.hiddenBoostBp ?? 0;
  if (hidden > 0) {
    for (const tier of RARE_PLUS) capped[tier] = mulDivFloor(capped[tier], BP + hidden, BP);
  }
  return capped;
}

/**
 * D-116: hidden starter luck. New players get newbieBoostBp for their first spins; anyone whose
 * total balance (wallet plus active cards) is below the threshold gets lowBalanceBoostBp.
 */
export function hiddenBoostBp(
  config: GameConfig,
  totalSpins: number,
  currency: Currency,
  totalBalance: number | undefined,
): number {
  const rules = config.luck.hidden;
  const newbie = totalSpins < rules.newbieSpins ? rules.newbieBoostBp : 0;
  const threshold = rules.lowBalanceBelow[currency];
  const poor = totalBalance !== undefined && totalBalance < threshold ? rules.lowBalanceBoostBp : 0;
  return Math.max(newbie, poor);
}

/** Weights restricted to tiers at or above `floor`; falls back to the floor itself if all are 0. */
export function weightsFromFloor(
  weights: Readonly<Record<Tier, number>>,
  floor: Tier,
): [Tier, number][] {
  const allowed = TIERS.filter((tier) => tierRank(tier) >= tierRank(floor));
  const entries = allowed.map((tier): [Tier, number] => [tier, weights[tier]]);
  return entries.some(([, weight]) => weight > 0) ? entries : [[floor, 1]];
}
