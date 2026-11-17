import { create } from 'zustand';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

interface SessionState {
  /** Kept in memory only: every launch signs in again with fresh initData. */
  tokens: Tokens | null;
  setTokens: (tokens: Tokens | null) => void;
}

export const useSession = create<SessionState>((set) => ({
  tokens: null,
  setTokens: (tokens) => {
    set({ tokens });
  },
}));
