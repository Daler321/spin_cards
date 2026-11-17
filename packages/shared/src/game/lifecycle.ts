import type { GameConfig } from './config-schema.js';
import { type Tier, tierRank } from './constants.js';

/**
 * Extension and restore prices of a card (D-115): by rarity, not by balance, so an empty card is
 * not free to keep. Geometric in the tier, plus the number's rarity points (capped). Shared by the
 * server (charges) and the Mini App (shows).
 */
export function lifecyclePrices(
  card: { tier: Tier; rarityScore: number },
  currency: string,
  lifecycle: Pick<GameConfig['lifecycle'], 'extendPrice' | 'restoreMultBp'>,
): { extend: number; restore: number } {
  const extend = rarityPrice(card, currency, lifecycle.extendPrice);
  return { extend, restore: Math.round((extend * lifecycle.restoreMultBp) / 10_000) };
}

/** A price schedule by rarity: base × growth per tier above Common × (1 + rarity × point), capped. */
export function rarityPrice(
  card: { tier: Tier; rarityScore: number },
  currency: string,
  schedule: GameConfig['lifecycle']['extendPrice'],
): number {
  const { base, tierGrowthBp, rarityPointBp, rarityCapBp } = schedule;
  let price = base[currency as keyof typeof base];
  for (let i = 0; i < tierRank(card.tier); i++) price = (price * tierGrowthBp) / 10_000;
  const rarityBp = Math.min(10_000 + card.rarityScore * rarityPointBp, rarityCapBp);
  return Math.round((price * rarityBp) / 10_000);
}

/**
 * What putting a card into the album costs (D-129): by tier, plus the number's pattern points (the
 * tier's own rarity points are already in its price).
 */
export function trophyPrice(
  card: { tier: Tier; rarityScore: number },
  currency: string,
  config: Pick<GameConfig, 'showcase' | 'tiers'>,
): number {
  const patternPoints = Math.max(0, card.rarityScore - config.tiers[card.tier].rarityPoints);
  return rarityPrice(
    { tier: card.tier, rarityScore: patternPoints },
    currency,
    config.showcase.price,
  );
}
