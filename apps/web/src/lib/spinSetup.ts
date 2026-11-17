import type {
  CardView,
  Currency,
  MeResponse,
  PublicConfigResponse,
  PublicPack,
} from '@spincards/shared';
import { regionCurrency } from './money';
import { packPrice, type PaymentChoice, paymentCards, visiblePacks } from './packs';

export interface SpinSelection {
  packId: string;
  payment: PaymentChoice;
  count: number;
}

export interface SpinSetup {
  currency: Currency;
  packs: PublicPack[];
  pack: PublicPack | undefined;
  /** Held active cards of the region currency. */
  candidates: CardView[];
  /** The card picked to pay, whatever the pack (the header shows its balance). */
  selectedCard: CardView | undefined;
  /** The card that pays for this spin: none for the free pack. */
  payCard: CardView | undefined;
  maxCount: number;
  count: number;
  /** Price of the whole batch. */
  total: number;
}

/**
 * What the next press of «Крутить» will do, from the saved selection: the roulette and the header
 * read the same answer. Only a preview; the server decides and charges.
 */
export function spinSetup(
  me: MeResponse,
  config: PublicConfigResponse,
  cards: CardView[],
  selection: SpinSelection,
  now: number,
): SpinSetup {
  const currency = regionCurrency(me.region);
  const packs = visiblePacks(config, currency);
  const freeAvailable = me.game.freeSpins.available;
  const usablePacks = packs.filter(
    (p) => me.level >= p.unlockLevel && (!p.free || freeAvailable > 0),
  );
  const pack =
    usablePacks.find((p) => p.id === selection.packId) ??
    usablePacks.find((p) => !p.free) ??
    usablePacks[0];
  const candidates = paymentCards(cards, currency, now);
  const { payment } = selection;
  const selectedCard =
    payment.type === 'card' ? candidates.find((c) => c.id === payment.cardId) : undefined;
  const payCard = pack?.free ? undefined : selectedCard;
  // D-121: a holder card pays for a limited number of spins per window.
  const cardSpinsLeft = payCard?.spinLimit.left ?? 4;
  const maxCount = pack?.free
    ? Math.max(1, Math.min(4, freeAvailable))
    : Math.max(1, Math.min(4, cardSpinsLeft));
  const count = Math.min(selection.count, maxCount);
  const price = pack ? packPrice(pack, currency) : 0;
  return {
    currency,
    packs,
    pack,
    candidates,
    selectedCard,
    payCard,
    maxCount,
    count,
    total: price * count,
  };
}
