import type { CardView, Currency } from '@spincards/shared';
import { useHolder, useMe } from '../api/queries';
import { useWalletPrompt } from '../state/walletPrompt';
import { paymentCards } from './packs';

export type WalletCoverage = 'wallet' | 'topup' | 'short';

/**
 * Purchases are paid from the wallet. `topup` — the wallet is short, but with the kept cards
 * (after the cash-out fee) the player has enough: offer to move money in; `short` — not enough at all.
 */
export function walletCoverage(
  wallet: number,
  cards: CardView[],
  feeBp: number,
  price: number,
): WalletCoverage {
  if (wallet >= price) return 'wallet';
  const fromCards = cards.reduce(
    (sum, c) => sum + c.balance - Math.ceil((c.balance * feeBp) / 10_000),
    0,
  );
  return wallet + fromCards >= price ? 'topup' : 'short';
}

/**
 * Before a wallet purchase: true — go on (the wallet pays, or nothing can help and the server
 * answers as before); false — the top-up prompt is open instead.
 */
export function useWalletGuard(): {
  coverage: (currency: Currency, price: number) => WalletCoverage;
  guard: (currency: Currency, price: number) => boolean;
} {
  const me = useMe();
  const holder = useHolder();
  const ask = useWalletPrompt((s) => s.ask);
  const coverage = (currency: Currency, price: number) =>
    walletCoverage(
      me.data?.wallets.find((w) => w.currency === currency)?.balance ?? 0,
      paymentCards(holder.data?.cards ?? [], currency, Date.now()),
      me.data?.game.cashoutFeeBp ?? 0,
      price,
    );
  return {
    coverage,
    guard: (currency, price) => {
      if (coverage(currency, price) !== 'topup') return true;
      ask({ currency, price });
      return false;
    },
  };
}
