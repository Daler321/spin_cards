import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { HolderCurrency, HolderSort } from '../lib/holderSort';
import type { PaymentChoice } from '../lib/packs';

export type PayView = 'list' | 'cards';
export type PaySort = 'luck' | 'balance';

interface SelectionState {
  packId: string;
  payment: PaymentChoice;
  /** Spins per press, 1..4. */
  count: number;
  setPack: (packId: string) => void;
  setPayment: (payment: PaymentChoice) => void;
  setCount: (count: number) => void;
  /** The payment sheet: a compact list or the cards themselves, and its order. */
  payView: PayView;
  paySort: PaySort;
  setPayView: (payView: PayView) => void;
  setPaySort: (paySort: PaySort) => void;
  holderSort: HolderSort;
  holderCurrency: HolderCurrency;
  setHolderSort: (holderSort: HolderSort) => void;
  setHolderCurrency: (holderCurrency: HolderCurrency) => void;
}

/** What the player picked on the roulette (and the holder order) survives tab switches and relaunches (this device only). */
export const useSelection = create<SelectionState>()(
  persist(
    (set) => ({
      packId: 'basic',
      payment: { type: 'wallet' },
      count: 1,
      setPack: (packId) => {
        set({ packId });
      },
      setPayment: (payment) => {
        set({ payment });
      },
      setCount: (count) => {
        set({ count });
      },
      payView: 'list',
      paySort: 'luck',
      setPayView: (payView) => {
        set({ payView });
      },
      setPaySort: (paySort) => {
        set({ paySort });
      },
      holderSort: 'rarity',
      holderCurrency: 'all',
      setHolderSort: (holderSort) => {
        set({ holderSort });
      },
      setHolderCurrency: (holderCurrency) => {
        set({ holderCurrency });
      },
    }),
    {
      name: 'spincards.selection',
      storage: createJSONStorage(() => {
        try {
          return localStorage;
        } catch {
          return sessionStorage;
        }
      }),
    },
  ),
);
