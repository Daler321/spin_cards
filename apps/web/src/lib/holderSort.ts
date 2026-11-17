import type { CardView, PublicConfigResponse } from '@spincards/shared';

type Rates = PublicConfigResponse['conversion']['rates'];

export type HolderSort = 'rarity' | 'balance' | 'time';
export type HolderCurrency = 'all' | 'RUB' | 'USD';

/** When the card burns: the grace end for an expired card, the expiry otherwise. */
function burnsAt(card: CardView): number {
  return card.status === 'expired' && card.graceUntil
    ? Date.parse(card.graceUntil)
    : Date.parse(card.expiresAt);
}

/** Balance in rubles at the current rate, for comparing cards of different currencies. */
function rubValue(card: CardView, rates: Rates): number {
  if (card.currency === 'RUB') return card.balance;
  const rate = rates.find((r) => r.fromCurrency === card.currency && r.toCurrency === 'RUB');
  return rate ? card.balance * (Number(rate.rateNano) / 1e9) : card.balance;
}

/** Holder list order: rarest, richest, or burning soonest first; ties fall back to rarity. */
export function arrangeCards(
  cards: CardView[],
  sort: HolderSort,
  currency: HolderCurrency,
  rates: Rates = [],
): CardView[] {
  const shown = currency === 'all' ? cards : cards.filter((c) => c.currency === currency);
  const byRarity = (a: CardView, b: CardView) =>
    b.rarityScore - a.rarityScore || b.balance - a.balance;
  const compare =
    sort === 'balance'
      ? (a: CardView, b: CardView) => rubValue(b, rates) - rubValue(a, rates) || byRarity(a, b)
      : sort === 'time'
        ? (a: CardView, b: CardView) => burnsAt(a) - burnsAt(b) || byRarity(a, b)
        : byRarity;
  return [...shown].sort(compare);
}
