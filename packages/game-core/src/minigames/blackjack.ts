import type { Rng } from '../ports.js';
import { shuffle } from './shuffle.js';

/**
 * D-169: 21. A card is 0..51: rank = card % 13 (0 = ace, 10..12 = jack, queen, king),
 * suit = floor(card / 13). The shoe of `decks` decks is shuffled once at the deal; the dealer
 * stands on every 17, a natural pays blackjackPayoutBp, the player may double on two cards.
 * No split, no insurance.
 */
export type BlackjackOutcome = 'blackjack' | 'win' | 'push' | 'lose';

export interface BlackjackState {
  shoe: number[];
  /** Next card to draw. */
  pos: number;
  player: number[];
  dealer: number[];
  doubled: boolean;
  /** Set when the round is over. */
  outcome: BlackjackOutcome | null;
}

export type BlackjackAction = 'hit' | 'stand' | 'double';

export const cardRank = (card: number) => card % 13;
const cardPoints = (card: number) => Math.min(cardRank(card) + 1, 10);

export function handValue(cards: readonly number[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardPoints(card);
    if (cardRank(card) === 0) aces += 1;
  }
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}

const isNatural = (cards: readonly number[]) => cards.length === 2 && handValue(cards).total === 21;

function draw(state: BlackjackState): number {
  const card = state.shoe[state.pos];
  if (card === undefined) throw new Error('blackjack shoe is empty');
  state.pos += 1;
  return card;
}

/** Shuffles a fresh shoe and deals two cards each; a natural on either side ends the round. */
export function dealBlackjack(rng: Rng, decks: number): BlackjackState {
  const shoe = shuffle(
    rng,
    Array.from({ length: decks * 52 }, (_, i) => i % 52),
  );
  const state: BlackjackState = {
    shoe,
    pos: 0,
    player: [],
    dealer: [],
    doubled: false,
    outcome: null,
  };
  state.player.push(draw(state));
  state.dealer.push(draw(state));
  state.player.push(draw(state));
  state.dealer.push(draw(state));
  const playerNatural = isNatural(state.player);
  const dealerNatural = isNatural(state.dealer);
  if (playerNatural || dealerNatural) {
    state.outcome = playerNatural && dealerNatural ? 'push' : playerNatural ? 'blackjack' : 'lose';
  }
  return state;
}

export function canDouble(state: BlackjackState): boolean {
  return state.outcome === null && state.player.length === 2 && !state.doubled;
}

/** Applies one player action to an open round (mutates and returns the state). */
export function actBlackjack(state: BlackjackState, action: BlackjackAction): BlackjackState {
  if (state.outcome !== null) throw new Error('blackjack round is over');
  if (action === 'double') {
    if (!canDouble(state)) throw new Error('blackjack double is not allowed');
    state.doubled = true;
    state.player.push(draw(state));
    return finish(state);
  }
  if (action === 'hit') {
    state.player.push(draw(state));
    const { total } = handValue(state.player);
    if (total > 21) state.outcome = 'lose';
    else if (total === 21) return finish(state);
    return state;
  }
  return finish(state);
}

/** The player stops: the dealer draws to 17 (unless the player is bust) and hands compare. */
function finish(state: BlackjackState): BlackjackState {
  const player = handValue(state.player).total;
  if (player > 21) {
    state.outcome = 'lose';
    return state;
  }
  while (handValue(state.dealer).total < 17) state.dealer.push(draw(state));
  const dealer = handValue(state.dealer).total;
  state.outcome = dealer > 21 || player > dealer ? 'win' : player === dealer ? 'push' : 'lose';
  return state;
}

/** Total return of the round in bp of the base bet (a double doubles it). */
export function blackjackReturnBp(
  state: Pick<BlackjackState, 'outcome' | 'doubled'>,
  blackjackPayoutBp: number,
): number {
  const stake = state.doubled ? 2 : 1;
  switch (state.outcome) {
    case 'blackjack':
      return blackjackPayoutBp;
    case 'win':
      return 20_000 * stake;
    case 'push':
      return 10_000 * stake;
    default:
      return 0;
  }
}

/**
 * Basic strategy for a 6-deck shoe, dealer stands on 17, no split (pairs play as totals). Used by
 * the simulator to report the return of a careful player.
 */
export function basicStrategy(state: BlackjackState): BlackjackAction {
  const { total, soft } = handValue(state.player);
  const up = cardPoints(state.dealer[0] as number);
  const upAce = cardRank(state.dealer[0] as number) === 0;
  const dealerUp = upAce ? 11 : up;
  const two = state.player.length === 2;
  const doubleOr = (fallback: BlackjackAction): BlackjackAction => (two ? 'double' : fallback);
  if (soft) {
    if (total >= 19) return 'stand';
    if (total === 18) {
      if (dealerUp >= 3 && dealerUp <= 6) return doubleOr('stand');
      return dealerUp <= 8 ? 'stand' : 'hit';
    }
    if (total === 17 && dealerUp >= 3 && dealerUp <= 6) return doubleOr('hit');
    if (total >= 15 && dealerUp >= 4 && dealerUp <= 6) return doubleOr('hit');
    if (total >= 13 && dealerUp >= 5 && dealerUp <= 6) return doubleOr('hit');
    return 'hit';
  }
  if (total >= 17) return 'stand';
  if (total >= 13) return dealerUp <= 6 ? 'stand' : 'hit';
  if (total === 12) return dealerUp >= 4 && dealerUp <= 6 ? 'stand' : 'hit';
  if (total === 11) return dealerUp <= 10 ? doubleOr('hit') : 'hit';
  if (total === 10) return dealerUp <= 9 ? doubleOr('hit') : 'hit';
  if (total === 9) return dealerUp >= 3 && dealerUp <= 6 ? doubleOr('hit') : 'hit';
  return 'hit';
}
