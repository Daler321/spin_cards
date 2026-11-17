import type { MiniGameDifficulty, MiniGameId, MiniGamesConfig } from '@spincards/shared';
import type { Rng } from '../ports.js';
import { actBlackjack, basicStrategy, blackjackReturnBp, dealBlackjack } from './blackjack.js';
import { minesReturnBp } from './mines.js';
import { plinkoReturnBp } from './plinko.js';

export interface MiniGameReturn {
  game: MiniGameId;
  difficulty: MiniGameDifficulty | null;
  /** Lowest and highest average return (bp) over the player's choices. */
  minBp: number;
  maxBp: number;
}

/**
 * D-169: returns of every mini-game for the config check: mines over every mine count and moment
 * of taking the money, plinko and the coin exactly, 21 by playing `blackjackRounds` rounds with
 * basic strategy.
 */
export function miniGameReturns(
  config: MiniGamesConfig,
  rng: Rng,
  blackjackRounds: number,
): MiniGameReturn[] {
  const out: MiniGameReturn[] = [];
  for (const d of config.mines.difficulties) {
    const returns: number[] = [];
    for (let mines = d.minMines; mines <= d.maxMines; mines++) {
      const params = { ...config.mines, cells: d.cells, mines };
      for (let opened = 1; opened <= d.cells - mines; opened++)
        returns.push(minesReturnBp(params, opened));
    }
    out.push({
      game: 'mines',
      difficulty: d.id,
      minBp: Math.min(...returns),
      maxBp: Math.max(...returns),
    });
  }
  for (const d of config.plinko.difficulties) {
    const rtp = plinkoReturnBp(d.rows, d.multipliersBp);
    out.push({ game: 'plinko', difficulty: d.id, minBp: rtp, maxBp: rtp });
  }
  const coin = Math.round(config.coinflip.payoutBp / 2);
  out.push({ game: 'coinflip', difficulty: null, minBp: coin, maxBp: coin });

  let staked = 0;
  let returned = 0;
  for (let i = 0; i < blackjackRounds; i++) {
    const state = dealBlackjack(rng, config.blackjack.decks);
    while (state.outcome === null) actBlackjack(state, basicStrategy(state));
    staked += state.doubled ? 2 : 1;
    returned += blackjackReturnBp(state, config.blackjack.blackjackPayoutBp);
  }
  const bj = staked > 0 ? Math.round(returned / staked) : 0;
  out.push({ game: 'blackjack', difficulty: null, minBp: bj, maxBp: bj });
  return out;
}
