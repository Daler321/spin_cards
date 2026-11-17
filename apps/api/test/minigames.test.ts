import {
  type BlackjackResponse,
  type CoinflipResponse,
  DEFAULT_GAME_CONFIG,
  type MiniGamesInfo,
  type MinesResponse,
  type PlinkoResponse,
} from '@spincards/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import {
  createTestApp,
  get,
  idempotencyKey,
  login,
  patchConfig,
  patchFlags,
  post,
  type TestApp,
} from './support/app.js';

type ErrorBody = { error: { code: string } };

describe('mini-games (D-169)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await patchConfig(t, (config) => {
      config.minigames = structuredClone(DEFAULT_GAME_CONFIG.minigames);
    });
    patchFlags(t, { minigames_enabled: true });
  });

  afterAll(() => t.close());

  const rub = async (userId: string) =>
    (
      await t.prisma.wallet.findUniqueOrThrow({
        where: { userId_currency: { userId, currency: 'RUB' } },
      })
    ).balance;
  const ledgerOf = (userId: string) =>
    t.prisma.ledgerEntry.findMany({
      where: { reason: { in: ['minigame_bet', 'minigame_win'] }, userId },
    });
  const roundState = async <T>(id: string) =>
    (await t.prisma.miniGameRound.findUniqueOrThrow({ where: { id } })).state as T;

  it('lists limits: at most 35 % of the wallet', async () => {
    const session = await login(t);
    const info = await get<MiniGamesInfo>(t, session, '/v1/minigames');
    if (!info.enabled) throw new Error('mini-games are on in this test');
    const wallet = info.wallets.find((w) => w.currency === 'RUB');
    const balance = await rub(session.userId);
    expect(wallet?.maxBet).toBe(Number((balance * 3500n) / 10_000n));
    expect(info.active).toEqual({ mines: null, blackjack: null });
  });

  it('coin: rejects a bet over the limit, pays ×1.94 and replays a repeated key', async () => {
    const session = await login(t);
    const balance = await rub(session.userId);
    const max = Number((balance * 3500n) / 10_000n);
    const tooHigh = await post<ErrorBody>(t, session, '/v1/minigames/coinflip', {
      currency: 'RUB',
      bet: max + 1,
      side: 'heads',
    });
    expect(tooHigh.body.error.code).toBe('MINIGAME_BET_TOO_HIGH');

    const key = idempotencyKey();
    const body = { currency: 'RUB', bet: 10_000, side: 'tails', idempotencyKey: key };
    const first = await post<CoinflipResponse>(t, session, '/v1/minigames/coinflip', body);
    expect(first.status).toBe(200);
    expect(first.body.payout).toBe(first.body.result === 'tails' ? 19_400 : 0);
    expect(first.body.wallet.balance).toBe(Number(balance) - 10_000 + first.body.payout);
    const again = await post<CoinflipResponse>(t, session, '/v1/minigames/coinflip', body);
    expect(again.body).toEqual(first.body);
    expect(await rub(session.userId)).toBe(BigInt(first.body.wallet.balance));
  });

  it('plinko: the stake of all balls counts against the limit, payouts follow the cups', async () => {
    const session = await login(t);
    const balance = await rub(session.userId);
    const res = await post<PlinkoResponse>(t, session, '/v1/minigames/plinko', {
      currency: 'RUB',
      betPerBall: 1000,
      balls: 30,
      difficulty: 'medium',
    });
    expect(res.status).toBe(200);
    expect(res.body.balls).toHaveLength(30);
    const cups = DEFAULT_GAME_CONFIG.minigames?.plinko.difficulties[1]?.multipliersBp ?? [];
    for (const ball of res.body.balls) {
      expect(ball.path).toHaveLength(12);
      expect(ball.multiplierBp).toBe(cups[ball.cup]);
      expect(ball.payout).toBe(Math.floor((1000 * ball.multiplierBp) / 10_000));
    }
    expect(res.body.payout).toBe(res.body.balls.reduce((s, b) => s + b.payout, 0));
    expect(await rub(session.userId)).toBe(balance - 30_000n + BigInt(res.body.payout));

    const tooHigh = await post<ErrorBody>(t, session, '/v1/minigames/plinko', {
      currency: 'RUB',
      betPerBall: Math.floor(Number(balance) / 30),
      balls: 30,
      difficulty: 'easy',
    });
    expect(tooHigh.body.error.code).toBe('MINIGAME_BET_TOO_HIGH');
  });

  it('mines: hides the field, pays the ladder on cash-out, one open round at a time', async () => {
    const session = await login(t);
    const balance = await rub(session.userId);
    const start = await post<MinesResponse>(t, session, '/v1/minigames/mines/start', {
      currency: 'RUB',
      bet: 10_000,
      difficulty: 'easy',
      mines: 3,
    });
    expect(start.status).toBe(200);
    const round = start.body.round;
    expect(round).toMatchObject({ cells: 12, mines: 3, minesAt: null, bonusCell: null });
    expect(round.safeChanceBp).toBe(7500);
    expect(JSON.stringify(start.body)).not.toContain('"bonus"');
    expect(start.body.wallet.balance).toBe(Number(balance) - 10_000);

    const second = await post<ErrorBody>(t, session, '/v1/minigames/mines/start', {
      currency: 'RUB',
      bet: 10_000,
      difficulty: 'easy',
      mines: 1,
    });
    expect(second.body.error.code).toBe('MINIGAME_ROUND_ACTIVE');

    const hidden = await roundState<{ minesAt: number[]; bonus: number }>(round.id);
    const safe = [...Array(12).keys()].find(
      (c) => !hidden.minesAt.includes(c) && c !== hidden.bonus,
    ) as number;
    const opened = await post<MinesResponse>(t, session, '/v1/minigames/mines/open', {
      roundId: round.id,
      cell: safe,
    });
    expect(opened.body.round.opened).toEqual([safe]);
    expect(opened.body.round.multiplierBp).toBe(round.nextMultiplierBp);
    const repeat = await post<ErrorBody>(t, session, '/v1/minigames/mines/open', {
      roundId: round.id,
      cell: safe,
    });
    expect(repeat.body.error.code).toBe('MINIGAME_INVALID_MOVE');

    const bonus = await post<MinesResponse>(t, session, '/v1/minigames/mines/open', {
      roundId: round.id,
      cell: hidden.bonus,
    });
    expect(bonus.body.round).toMatchObject({ bonusFound: true, bonusCell: hidden.bonus });

    const cash = await post<MinesResponse>(t, session, '/v1/minigames/mines/cashout', {
      roundId: round.id,
    });
    const mult = bonus.body.round.multiplierBp;
    expect(cash.body.round.status).toBe('finished');
    expect(cash.body.round.payout).toBe(Math.floor((10_000 * mult) / 10_000));
    expect(cash.body.round.minesAt).toEqual(hidden.minesAt);
    expect(await rub(session.userId)).toBe(balance - 10_000n + BigInt(cash.body.round.payout));

    const over = await post<ErrorBody>(t, session, '/v1/minigames/mines/cashout', {
      roundId: round.id,
    });
    expect(over.body.error.code).toBe('MINIGAME_ROUND_OVER');
  });

  it('mines: a mine ends the round unpaid', async () => {
    const session = await login(t);
    const start = await post<MinesResponse>(t, session, '/v1/minigames/mines/start', {
      currency: 'RUB',
      bet: 5000,
      difficulty: 'hard',
      mines: 20,
    });
    const hidden = await roundState<{ minesAt: number[] }>(start.body.round.id);
    const boom = await post<MinesResponse>(t, session, '/v1/minigames/mines/open', {
      roundId: start.body.round.id,
      cell: hidden.minesAt[0],
    });
    expect(boom.body.round).toMatchObject({
      status: 'finished',
      payout: 0,
      exploded: hidden.minesAt[0],
    });
    expect(boom.body.round.minesAt).toHaveLength(20);
  });

  it('21: hides the dealer card, a double stakes the bet again and pays ×2 of both', async () => {
    const session = await login(t);
    let round: BlackjackResponse['round'] | undefined;
    // A natural ends the deal at once; deal again until a hand is open.
    for (let i = 0; i < 20 && round?.status !== 'active'; i++) {
      round = (
        await post<BlackjackResponse>(t, session, '/v1/minigames/blackjack/start', {
          currency: 'RUB',
          bet: 10_000,
        })
      ).body.round;
    }
    if (round?.status !== 'active') throw new Error('no open hand in 20 deals');
    expect(round.dealer).toHaveLength(1);
    expect(round.dealerTotal).toBeNull();

    // Fix the cards: player 6 + 5, dealer 10 + 8, next card a 10 → 21 against 18.
    const state = await roundState<Record<string, unknown>>(round.id);
    await t.prisma.miniGameRound.update({
      where: { id: round.id },
      data: { state: { ...state, player: [5, 4], dealer: [9, 7], shoe: [9], pos: 0 } },
    });
    const before = await rub(session.userId);
    const res = await post<BlackjackResponse>(t, session, '/v1/minigames/blackjack/act', {
      roundId: round.id,
      action: 'double',
    });
    expect(res.body.round).toMatchObject({
      status: 'finished',
      outcome: 'win',
      bet: 20_000,
      payout: 40_000,
      playerTotal: 21,
      dealerTotal: 18,
    });
    expect(await rub(session.userId)).toBe(before - 10_000n + 40_000n);
  });

  it('a round left from an older season is closed unpaid', async () => {
    const session = await login(t);
    const start = await post<MinesResponse>(t, session, '/v1/minigames/mines/start', {
      currency: 'RUB',
      bet: 5000,
      difficulty: 'easy',
      mines: 1,
    });
    const old = await t.prisma.season.create({
      data: { name: 'test old', startsAt: new Date(0), endsAt: new Date(1), status: 'finished' },
    });
    await t.prisma.miniGameRound.update({
      where: { id: start.body.round.id },
      data: { seasonId: old.id },
    });
    const info = await get<MiniGamesInfo>(t, session, '/v1/minigames');
    expect(info.enabled && info.active.mines).toBeNull();
    const cash = await post<ErrorBody>(t, session, '/v1/minigames/mines/cashout', {
      roundId: start.body.round.id,
    });
    expect(cash.body.error.code).toBe('MINIGAME_ROUND_OVER');
    // Other test files share the DB: drop the test season again.
    await t.prisma.miniGameRound.delete({ where: { id: start.body.round.id } });
    await t.prisma.season.delete({ where: { id: old.id } });
  });

  it('is closed while the flag is off, and the ledger matches the wallets', async () => {
    const session = await login(t);
    patchFlags(t, { minigames_enabled: false });
    try {
      expect(await get<MiniGamesInfo>(t, session, '/v1/minigames')).toEqual({ enabled: false });
      const res = await post<ErrorBody>(t, session, '/v1/minigames/coinflip', {
        currency: 'RUB',
        bet: 1000,
        side: 'heads',
      });
      expect(res.body.error.code).toBe('NOT_AVAILABLE');
    } finally {
      patchFlags(t, { minigames_enabled: true });
    }
    expect((await ledgerOf(session.userId)).length).toBe(0);
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });
});
