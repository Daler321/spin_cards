import type { GameConfig } from './config-schema.js';
import { isUpgradeTier, type Tier } from './constants.js';

/**
 * D-146: Telegram Stars products. A product id is `<kind>` or `<kind>:<ref>` (buff, free spins and
 * holder offers); card products also name the card in the purchase.
 */
export const STARS_PRODUCT_KINDS = [
  'buff',
  'free_spins',
  'holder',
  'album_slot',
  'chest_upgrade',
  'wheel_now',
  'card_limit_reset',
  'card_extend',
  'trophy',
  'card_upgrade',
] as const;
export type StarsProductKind = (typeof STARS_PRODUCT_KINDS)[number];

/** Products bought for one card (the card id goes with the purchase). */
export const CARD_STARS_PRODUCTS: readonly StarsProductKind[] = [
  'card_limit_reset',
  'card_extend',
  'trophy',
  'card_upgrade',
];

export interface StarsProductRef {
  kind: StarsProductKind;
  ref: string | null;
}

export function parseStarsProduct(productId: string): StarsProductRef | null {
  const [kind, ref, extra] = productId.split(':');
  if (extra !== undefined || !STARS_PRODUCT_KINDS.includes(kind as StarsProductKind)) return null;
  const needsRef = kind === 'buff' || kind === 'free_spins' || kind === 'holder';
  if (needsRef !== (ref !== undefined && ref !== '')) return null;
  return { kind: kind as StarsProductKind, ref: ref ?? null };
}

/** What the price depends on besides the config. */
export interface StarsPriceContext {
  cardTier?: Tier;
  chestLevel?: number;
}

/** The price in Stars, or null when the product is not on sale (unknown ref, max level, …). */
export function starsPrice(
  config: GameConfig,
  product: StarsProductRef,
  context: StarsPriceContext = {},
): number | null {
  const { stars } = config;
  switch (product.kind) {
    case 'buff':
      return stars.buffs.find((b) => b.id === product.ref)?.stars ?? null;
    case 'free_spins':
      return stars.freeSpins.find((o) => o.id === product.ref)?.stars ?? null;
    case 'holder':
      return config.holders.find((h) => h.id === product.ref)?.starsPrice ?? null;
    case 'album_slot':
      return config.showcase.extraSlotStars;
    case 'chest_upgrade': {
      if (context.chestLevel === undefined) return null;
      const next = config.chest.levels.find((l) => l.level === (context.chestLevel ?? 0) + 1);
      return next?.upgradeStarsPrice ?? null;
    }
    case 'wheel_now':
      return stars.wheelNow;
    case 'card_limit_reset':
      return stars.cardLimitReset;
    case 'card_extend':
      return context.cardTier ? stars.cardExtend[context.cardTier] : null;
    case 'trophy':
      return context.cardTier ? stars.trophy[context.cardTier] : null;
    case 'card_upgrade':
      return context.cardTier && isUpgradeTier(context.cardTier)
        ? stars.cardUpgrade[context.cardTier]
        : null;
  }
}
