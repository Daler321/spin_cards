/** Contextual hints are shown only while the player is new (UI only, not game economy). */
export const TUTORIAL_SPINS = 10;

export type TutorialStep = 'firstSpin' | 'keepCards' | 'payWithCard' | 'cardLuck';

export interface TutorialState {
  totalSpins: number;
  /** A paid pack is selected (cards can pay only for those). */
  paidPack: boolean;
  /** Held cards that can pay in the region currency. */
  payableCards: number;
  payingWithCard: boolean;
  dismissed: ReadonlySet<TutorialStep>;
}

/** The one hint that fits the player's situation now, or null. */
export function tutorialStep(s: TutorialState): TutorialStep | null {
  if (s.totalSpins >= TUTORIAL_SPINS) return null;
  const candidates: (TutorialStep | false)[] = [
    s.totalSpins === 0 && 'firstSpin',
    s.totalSpins > 0 && s.payableCards === 0 && 'keepCards',
    s.paidPack && s.payableCards > 0 && !s.payingWithCard && 'payWithCard',
    s.paidPack && s.payingWithCard && 'cardLuck',
  ];
  return (
    candidates.find((step): step is TutorialStep => step !== false && !s.dismissed.has(step)) ??
    null
  );
}

const DISMISSED_KEY = 'spincards.tutorialDismissed';

export function loadDismissed(): Set<TutorialStep> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as TutorialStep[]) : []);
  } catch {
    return new Set();
  }
}

export function saveDismissed(steps: ReadonlySet<TutorialStep>): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...steps]));
  } catch {
    // Private mode: the hint may show again, that's fine.
  }
}
