import type { CardView, Currency, PublicConfigResponse, PublicPack } from '@spincards/shared';

/** Packs the player can see in this currency: free, or sold for it (Stars-only packs are hidden). */
export function visiblePacks(config: PublicConfigResponse, currency: Currency): PublicPack[] {
  return config.packs.filter((p) => p.free || p.prices[currency] !== undefined);
}

export function packPrice(pack: PublicPack, currency: Currency): number {
  return pack.free ? 0 : (pack.prices[currency] ?? 0);
}

export type PaymentChoice = { type: 'wallet' } | { type: 'card'; cardId: string };

/** Held, active cards of the region currency: candidates to pay for a spin. */
export function paymentCards(cards: CardView[], currency: Currency, now: number): CardView[] {
  return cards.filter(
    (c) =>
      c.held && c.status === 'active' && c.currency === currency && Date.parse(c.expiresAt) > now,
  );
}

/** Payment candidates that can cover the price right now. */
export function usableCards(
  cards: CardView[],
  currency: Currency,
  price: number,
  now: number,
): CardView[] {
  return paymentCards(cards, currency, now).filter((c) => c.balance >= price);
}
