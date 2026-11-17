import { create } from 'zustand';

export const PROFILE_TABS = ['info', 'settings'] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

interface UiState {
  /** A spin is printing or its card is on screen: region switching waits. */
  spinBusy: boolean;
  setSpinBusy: (busy: boolean) => void;
  /** The profile tab survives screens opened over the profile (odds, rules). */
  profileTab: ProfileTab;
  setProfileTab: (tab: ProfileTab) => void;
}

export const useUi = create<UiState>((set) => ({
  spinBusy: false,
  setSpinBusy: (spinBusy) => {
    set({ spinBusy });
  },
  profileTab: 'info',
  setProfileTab: (profileTab) => {
    set({ profileTab });
  },
}));
