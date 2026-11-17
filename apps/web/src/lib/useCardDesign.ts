import { type CardDesign, LATEST_CARD_DESIGN } from '@spincards/shared';
import { createContext, useContext } from 'react';

/**
 * D-168: the card design of the current season. The shell provides it from the public config;
 * outside it (tests, onboarding) cards get the newest design.
 */
export const SeasonCardDesign = createContext<CardDesign>(LATEST_CARD_DESIGN);

export function useSeasonCardDesign(): CardDesign {
  return useContext(SeasonCardDesign);
}

/** A trophy keeps the design it was put into the album with; any other card follows the season. */
export function useCardDesign(stored: CardDesign | null | undefined): CardDesign {
  const season = useSeasonCardDesign();
  return stored ?? season;
}
