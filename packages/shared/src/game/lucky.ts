/** Why a spin is a lucky one (TZ 5.5): the milestone beats the full meter, which beats the return bonus. */
export type LuckySource = 'meter' | 'return' | 'milestone';

export interface LuckyState {
  /** The player's spins before this one. */
  totalSpins: number;
  /** Luck meter of the pack and its maximum. */
  meter: number;
  meterMax: number;
  /** Every `everySpins`-th spin of a player is a milestone (showcase) spin. */
  everySpins: number;
  freePack: boolean;
  /** The comeback bonus: the next free spin is lucky. */
  returnPending: boolean;
}

/** Shared by the server (which decides) and the Mini App (which shows it before the spin). */
export function luckySource(state: LuckyState): LuckySource | null {
  if ((state.totalSpins + 1) % state.everySpins === 0) return 'milestone';
  if (state.meter >= state.meterMax) return 'meter';
  if (state.freePack && state.returnPending) return 'return';
  return null;
}

/** Whether a batch of `count` spins starting now contains a lucky spin (button hint). */
export function batchHasLucky(state: LuckyState, count: number): boolean {
  if (luckySource(state)) return true;
  const toMilestone = state.everySpins - (state.totalSpins % state.everySpins);
  return toMilestone <= count;
}
