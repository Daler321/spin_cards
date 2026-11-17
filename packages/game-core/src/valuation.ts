import type { GameConfig, Tier } from '@spincards/shared';
import { BP, mulDivFloor } from './math.js';
import type { PatternMatch } from './number/patterns.js';

/** Pattern multipliers add up (×2.5 + ×2.0 = ×4.5); no pattern means ×1; the total is capped. */
export function numberMultBp(patterns: readonly PatternMatch[], config: GameConfig): number {
  if (patterns.length === 0) return BP;
  const sum = patterns.reduce((acc, p) => acc + config.patterns.byId[p.id].multBp, 0);
  return Math.min(sum, config.patterns.numberMultCapBp);
}

/** balance = floor(base_limit × design_mult × number_mult), integer minor units. */
export function cardBalance(baseLimit: number, designMultBp: number, numberMult: number): number {
  return Number((BigInt(baseLimit) * BigInt(designMultBp) * BigInt(numberMult)) / BigInt(BP * BP));
}

export function rarityScore(
  tier: Tier,
  patterns: readonly PatternMatch[],
  config: GameConfig,
): number {
  return patterns.reduce(
    (acc, p) => acc + config.patterns.byId[p.id].rarityPoints,
    config.tiers[tier].rarityPoints,
  );
}

/**
 * D-147: luck points a card gives when it pays for a spin: its tier's points plus its number's
 * (pattern rarity points, up to a cap). A card alone stays below the maximum.
 */
export function cardLuckPoints(
  tier: Tier,
  patterns: readonly PatternMatch[],
  config: GameConfig,
): number {
  const { pointsPerPatternPoint, numberCapPoints } = config.cardLuck;
  const points = patterns.reduce((acc, p) => acc + config.patterns.byId[p.id].rarityPoints, 0);
  return Math.min(
    config.tiers[tier].cardLuckPoints + Math.min(points * pointsPerPatternPoint, numberCapPoints),
    config.luck.maxPoints,
  );
}

/** The number's part of a card's luck points (shown next to the tier's). */
export function numberLuckPoints(cardPoints: number, tier: Tier, config: GameConfig): number {
  return Math.max(0, cardPoints - config.tiers[tier].cardLuckPoints);
}

/** Cash-out fee for a player level: base fee minus a per-level discount, never below the floor. */
export function cashoutFeeBp(level: number, config: GameConfig): number {
  const { baseFeeBp, feeReductionPerLevelBp, minFeeBp } = config.cashout;
  return Math.max(minFeeBp, baseFeeBp - (Math.max(level, 1) - 1) * feeReductionPerLevelBp);
}

export function cashoutPayout(balance: number, feeBp: number): number {
  return mulDivFloor(balance, BP - feeBp, BP);
}
