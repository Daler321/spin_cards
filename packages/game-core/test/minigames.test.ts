import { describe, expect, it } from 'vitest';
import {
  actBlackjack,
  blackjackReturnBp,
  createSeededRng,
  dealBlackjack,
  dropBall,
  flipCoin,
  handValue,
  layMines,
  miniGameReturns,
  minesMultiplierBp,
  minesReturnBp,
  minesSafeChanceBp,
  plinkoReturnBp,
  type BlackjackState,
} from '../src/index.js';
import { config } from './helpers.js';

const games = () => {
  const minigames = config().minigames;
  if (!minigames) throw new Error('default config has mini-games');
  return minigames;
};

describe('mines', () => {
  const params = { cells: 12, mines: 3, houseEdgeBp: 300, bonusBp: 5000 };

  it('lays the mines and a bonus cell on distinct cells', () => {
    const rng = createSeededRng(1);
    for (let i = 0; i < 200; i++) {
      const layout = layMines(rng, 24, 8);
      expect(new Set([...layout.mines, layout.bonus]).size).toBe(9);
      expect([...layout.mines, layout.bonus].every((c) => c >= 0 && c < 24)).toBe(true);
    }
  });

  it('every moment of taking the money returns 1 - edge on average', () => {
    for (const mines of [1, 2, 3]) {
      for (let opened = 1; opened <= 12 - mines; opened++) {
        const rtp = minesReturnBp({ ...params, mines }, opened);
        expect(rtp).toBeGreaterThanOrEqual(9690);
        expect(rtp).toBeLessThanOrEqual(9700);
      }
    }
  });

  it('the bonus raises the winnings at once by bonusBp', () => {
    const before = minesMultiplierBp(params, 2, null);
    const withBonus = minesMultiplierBp(params, 3, 3);
    const without = minesMultiplierBp(params, 3, null);
    expect(withBonus / without).toBeCloseTo(1.5, 3);
    expect(without).toBeGreaterThan(before);
  });

  it('safe chance counts the cells left', () => {
    expect(minesSafeChanceBp(12, 3, 0)).toBe(7500);
    expect(minesSafeChanceBp(12, 3, 9)).toBe(0);
  });

  it('stopping right after the bonus gains nothing (optimal play stays at 1 - edge)', () => {
    // Exact optimal-stopping value over (opened, bonus step) with the rounded ladder.
    const { cells, mines } = { cells: 12, mines: 2 };
    const safe = cells - mines;
    const value = (opened: number, bonusStep: number | null): number => {
      const stop = opened === 0 ? 0 : minesMultiplierBp({ ...params, mines }, opened, bonusStep);
      if (opened === safe) return stop;
      const left = cells - opened;
      const safeLeft = safe - opened;
      const go =
        bonusStep === null
          ? ((safeLeft - 1) / left) * value(opened + 1, null) +
            (1 / left) * value(opened + 1, opened + 1)
          : (safeLeft / left) * value(opened + 1, bonusStep);
      return opened === 0 ? go : Math.max(stop, go);
    };
    expect(value(0, null)).toBeLessThanOrEqual(9700);
  });
});

describe('plinko', () => {
  it('a ball lands in the cup of its right bounces', () => {
    const rng = createSeededRng(2);
    const ball = dropBall(rng, 12);
    expect(ball.path).toHaveLength(12);
    expect(ball.cup).toBe(ball.path.filter((s) => s === 1).length);
  });

  it('the default boards return about 97 %', () => {
    for (const d of games().plinko.difficulties) {
      const rtp = plinkoReturnBp(d.rows, d.multipliersBp);
      expect(rtp).toBeGreaterThan(9600);
      expect(rtp).toBeLessThan(9800);
      expect(d.multipliersBp[0]).toBe(100_000);
      expect(d.multipliersBp[d.rows / 2]).toBe(1000);
    }
  });
});

describe('coin', () => {
  it('both sides fall about evenly', () => {
    const rng = createSeededRng(3);
    let heads = 0;
    for (let i = 0; i < 10_000; i++) if (flipCoin(rng) === 'heads') heads += 1;
    expect(heads).toBeGreaterThan(4800);
    expect(heads).toBeLessThan(5200);
  });
});

describe('21', () => {
  const card = (rank: number) => rank; // suit 0
  const state = (player: number[], dealer: number[], shoe: number[] = []): BlackjackState => ({
    shoe,
    pos: 0,
    player,
    dealer,
    doubled: false,
    outcome: null,
  });

  it('counts aces as 11 while it fits', () => {
    expect(handValue([card(0), card(12)])).toEqual({ total: 21, soft: true });
    expect(handValue([card(0), card(0), card(8)])).toEqual({ total: 21, soft: true });
    expect(handValue([card(0), card(8), card(9)])).toEqual({ total: 20, soft: false });
  });

  it('a bust loses at once', () => {
    const s = actBlackjack(state([card(9), card(5)], [card(9), card(6)], [card(9)]), 'hit');
    expect(s.outcome).toBe('lose');
    expect(s.dealer).toHaveLength(2);
  });

  it('the dealer draws to 17 and stands on every 17', () => {
    const s = actBlackjack(
      state([card(9), card(8)], [card(5), card(4)], [card(0), card(9)]),
      'stand',
    );
    // 6 + 5 = 11, an ace counts 1 (12), then 10 → 22: the dealer is bust.
    expect(handValue(s.dealer).total).toBeGreaterThanOrEqual(17);
    expect(s.outcome).toBe('win');
  });

  it('a double takes one card and doubles the return', () => {
    const s = actBlackjack(state([card(5), card(4)], [card(9), card(7)], [card(9)]), 'double');
    expect(s.player).toHaveLength(3);
    expect(s.outcome).toBe('win');
    expect(blackjackReturnBp(s, 25_000)).toBe(40_000);
  });

  it('a natural pays 3:2 and a push returns the stake', () => {
    expect(blackjackReturnBp({ outcome: 'blackjack', doubled: false }, 25_000)).toBe(25_000);
    expect(blackjackReturnBp({ outcome: 'push', doubled: false }, 25_000)).toBe(10_000);
    expect(blackjackReturnBp({ outcome: 'lose', doubled: true }, 25_000)).toBe(0);
  });

  it('the deal uses a full shoe of distinct positions', () => {
    const s = dealBlackjack(createSeededRng(4), 6);
    expect(s.shoe).toHaveLength(312);
    expect(s.pos).toBe(4);
    expect(s.player).toHaveLength(2);
  });
});

describe('mini-game returns', () => {
  it('every default game stays near 97–100 %', () => {
    const report = miniGameReturns(games(), createSeededRng(5), 100_000);
    for (const item of report) {
      expect(item.minBp, `${item.game} ${String(item.difficulty)}`).toBeGreaterThan(9500);
      expect(item.maxBp, `${item.game} ${String(item.difficulty)}`).toBeLessThan(10_100);
    }
    expect(report.map((r) => r.game)).toEqual([
      'mines',
      'mines',
      'mines',
      'plinko',
      'plinko',
      'plinko',
      'coinflip',
      'blackjack',
    ]);
  });
});
