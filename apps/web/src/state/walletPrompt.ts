import type { Currency } from '@spincards/shared';
import { create } from 'zustand';

export interface WalletRequest {
  currency: Currency;
  /** The price of the purchase that the wallet cannot pay yet. */
  price: number;
}

interface WalletPromptState {
  request: WalletRequest | null;
  ask: (request: WalletRequest) => void;
  close: () => void;
}

/** D-166: «top the wallet up from a card» before a purchase the wallet alone cannot pay. */
export const useWalletPrompt = create<WalletPromptState>((set) => ({
  request: null,
  ask: (request) => {
    set({ request });
  },
  close: () => {
    set({ request: null });
  },
}));
