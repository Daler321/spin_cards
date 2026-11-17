import type {
  ChestUpgradeResponse,
  HolderView,
  LeaderboardResponse,
  MeResponse,
  PublicConfigResponse,
  SpinResponse,
  WheelSpinResponse,
} from '@spincards/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import {
  createTestApp,
  fund,
  idempotencyKey,
  login,
  post,
  type Session,
  type TestApp,
} from './support/app.js';

type ErrorBody = { error: { code: string } };

describe('multi-spin, cashout to card, wheel, chest levels', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  const get = async <T>(session: Session, url: string) =>
    (await t.app.inject({ url, headers: session.auth })).json<T>();
  const veteran = async () => {
    const session = await login(t);
    await t.prisma.user.update({ where: { id: session.userId }, data: { totalSpins: 30 } });
    return session;
  };

  it('pays for 4 spins at once and resolves them one after another', async () => {
    const session = await veteran();
    const key = idempotencyKey();
    const res = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
      count: 4,
      idempotencyKey: key,
    });
    expect(res.status).toBe(200);
    expect(res.body.spins).toHaveLength(4);
    expect(new Set(res.body.spins.map((s) => s.card.number)).size).toBe(4);
    expect(res.body.wallets).toContainEqual({ currency: 'RUB', balance: 100_000 });
    expect(res.body.luckMeter.value).toBe(4);

    const holder = await get<HolderView>(session, '/v1/cards');
    expect(holder.pending).toHaveLength(4);
    const blocked = await post<ErrorBody>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    expect(blocked.body.error.code).toBe('CARD_DECISION_PENDING');

    const replay = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
      count: 4,
      idempotencyKey: key,
    });
    expect(replay.body.spins.map((s) => s.spinId)).toEqual(res.body.spins.map((s) => s.spinId));
    expect(await t.prisma.spin.count({ where: { userId: session.userId } })).toBe(4);
  });

  it('rejects a batch the wallet or the free stock cannot cover', async () => {
    const session = await veteran();
    const five = await post<ErrorBody>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
      count: 5,
    });
    expect(five.body.error.code).toBe('VALIDATION_FAILED');
    const free = await post<ErrorBody>(t, session, '/v1/spin', {
      packId: 'free',
      payment: { type: 'wallet' },
      count: 4,
    });
    expect(free.body.error.code).toBe('NO_FREE_SPINS');
    await fund(t, session.userId, 'RUB', -400_000n);
    const poor = await post<ErrorBody>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
      count: 2,
    });
    expect(poor.body.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('cashes a new card out onto the card that paid for the spin', async () => {
    const session = await veteran();
    const first = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    const payer = first.body.spins[0]!.card;
    await post(t, session, `/v1/cards/${payer.id}/hold`);
    await post(t, session, `/v1/cards/${payer.id}/topup`, { amount: 200_000 });

    const paid = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'card', cardId: payer.id },
    });
    const dropped = paid.body.spins[0]!.card;
    const before = paid.body.paymentCard!.balance;
    const res = await post<{
      payout: number;
      wallet: unknown;
      toCard: { id: string; balance: number };
    }>(t, session, `/v1/cards/${dropped.id}/cashout`, { toCardId: payer.id });
    expect(res.body).toMatchObject({
      wallet: null,
      toCard: { id: payer.id, balance: before + res.body.payout },
    });
    expect(res.body.payout).toBe(dropped.cashoutValue);

    const self = await post<ErrorBody>(t, session, `/v1/cards/${payer.id}/cashout`, {
      toCardId: payer.id,
    });
    expect(self.body.error.code).toBe('CARD_NOT_USABLE');
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('spins the free wheel every 4 hours with scaled money', async () => {
    const session = await veteran();
    await t.prisma.user.update({ where: { id: session.userId }, data: { level: 3 } });
    let me = await get<MeResponse>(session, '/v1/me');
    expect(me.game.wheel.availableAt).toBeNull();

    const res = await post<WheelSpinResponse>(t, session, '/v1/bonus/wheel/spin');
    expect(res.status).toBe(200);
    const config = await get<PublicConfigResponse>(session, '/v1/config/public');
    expect(config.wheel.segments[res.body.segmentIndex]?.id).toBe(res.body.segmentId);
    if (res.body.reward.money) {
      expect(res.body.credited?.amount).toBe(
        Math.floor((res.body.reward.money.RUB! * 10_200) / 10_000),
      );
    }
    expect((await post<ErrorBody>(t, session, '/v1/bonus/wheel/spin')).body.error.code).toBe(
      'WHEEL_NOT_READY',
    );
    me = await get<MeResponse>(session, '/v1/me');
    expect(Date.parse(me.game.wheel.availableAt!) - Date.now()).toBeGreaterThan(3.9 * 3_600_000);
    expect(config.wheel.segments.reduce((sum, s) => sum + s.oddsBp, 0)).toBe(10_000);
  });

  it('upgrades the chest for currency up to the last level', async () => {
    const session = await veteran();
    expect(
      (await post<ErrorBody>(t, session, '/v1/bonus/chest/upgrade', { currency: 'RUB' })).body.error
        .code,
    ).toBe('INSUFFICIENT_FUNDS');
    await fund(t, session.userId, 'RUB', 500_000_000n);
    for (let level = 2; level <= 5; level++) {
      const res = await post<ChestUpgradeResponse>(t, session, '/v1/bonus/chest/upgrade', {
        currency: 'RUB',
      });
      expect(res.body.chest.level).toBe(level);
    }
    expect(
      (await post<ErrorBody>(t, session, '/v1/bonus/chest/upgrade', { currency: 'RUB' })).body.error
        .code,
    ).toBe('CHEST_MAX_LEVEL');
    const me = await get<MeResponse>(session, '/v1/me');
    expect(me.game.chest).toMatchObject({ level: 5, available: 1 });
  });

  it('counts card balances in the balance leaderboard', async () => {
    const session = await login(t, { firstName: 'Картовладелец' });
    const res = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    await post(t, session, `/v1/cards/${res.body.spins[0]!.card.id}/hold`);
    const board = await get<LeaderboardResponse>(session, '/v1/leaderboard?type=balance');
    expect(board.me?.score).toBe(400_000 + res.body.spins[0]!.card.balance);
  });

  it('leaves players who have not spun this season out of the balance leaderboard', async () => {
    const idle = await login(t, { firstName: 'Новичок' });
    const board = await get<LeaderboardResponse>(idle, '/v1/leaderboard?type=balance');
    expect(board.me).toBeNull();
    expect(board.top.some((e) => e.userId === idle.userId)).toBe(false);
  });
});
