import type { MiniGameId } from '@spincards/shared';
import { create } from 'zustand';

/** `wallet` has no button of its own: it opens from «Ещё» and the transfer button. */
export type Tab = 'game' | 'holder' | 'bonuses' | 'rating' | 'more' | 'wallet';

export type Overlay =
  | { name: 'card'; cardId: string }
  | { name: 'profile' }
  | { name: 'odds' }
  | { name: 'quests' }
  | { name: 'album' }
  | { name: 'seasonCollection' }
  | { name: 'rules' }
  | { name: 'privacy' }
  | { name: 'minigame'; game: MiniGameId }
  | { name: 'shop'; cardId?: string }
  | { name: 'wheel' }
  | { name: 'craft' }
  | { name: 'minigames' }
  | { name: 'referrals' }
  | { name: 'medals' }
  | { name: 'nickBonus' }
  | { name: 'seasons' }
  | { name: 'playerSearch' };

interface NavigationState {
  tab: Tab;
  /** Screens opened over the tabs; Telegram's back button pops them. */
  stack: Overlay[];
  setTab: (tab: Tab) => void;
  open: (overlay: Overlay) => void;
  back: () => void;
}

export const useNavigation = create<NavigationState>((set) => ({
  tab: 'game',
  stack: [],
  setTab: (tab) => {
    set({ tab, stack: [] });
  },
  open: (overlay) => {
    set((s) => ({ stack: [...s.stack, overlay] }));
  },
  back: () => {
    set((s) => ({ stack: s.stack.slice(0, -1) }));
  },
}));
