import type {
  BatchCashoutResponse,
  HolderView,
  SpinResponse,
  TransferResponse,
} from '@spincards/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import { createTestApp, fund, login, post, type Session, type TestApp } from './support/app.js';

type ErrorBody = { error: { code: string } };

describe('batch decisions and transfers', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  const veteran = async () => {
    const session = await login(t);
    await t.prisma.user.update({ where: { id: session.userId }, data: { totalSpins: 10 } });
    return session;
  };
  const spinMany = async (session: Session, count: number, payment: object = { type: 'wallet' }) =>
    (
      await post<SpinResponse>(t, session, '/v1/spin', { packId: 'basic', payment, count })
    ).body.spins.map((s) => s.card);
  const rub = async (userId: string) =>
    (
      await t.prisma.wallet.findUniqueOrThrow({
        where: { userId_currency: { userId, currency: 'RUB' } },
      })
    ).balance;

  it('cashes out four cards in one request', async () => {
    const session = await veteran();
    const cards = await spinMany(session, 4);
    const res = await post<BatchCashoutResponse>(t, session, '/v1/cards/cashout-many', {
      cardIds: cards.map((c) => c.id),
    });
    expect(res.status).toBe(200);
    const expected = cards.reduce((sum, c) => sum + c.cashoutValue, 0);
    expect(res.body).toMatchObject({
      payout: expected,
      toCard: null,
      wallet: { currency: 'RUB', balance: 100_000 + expected },
    });
    expect(
      await t.prisma.card.count({
        where: { id: { in: cards.map((c) => c.id) }, status: 'pooled' },
      }),
    ).toBe(4);
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('cashes out a batch onto the paying card', async () => {
    const session = await veteran();
    const [payer] = await spinMany(session, 1);
    await post(t, session, `/v1/cards/${payer!.id}/hold`);
    await fund(t, session.userId, 'RUB', 1_000_000n);
    await post(t, session, '/v1/transfers', {
      from: { type: 'wallet' },
      to: { type: 'card', cardId: payer!.id },
      amount: 500_000,
    });
    const before = (await t.prisma.card.findUniqueOrThrow({ where: { id: payer!.id } })).balance;
    const dropped = await spinMany(session, 2, { type: 'card', cardId: payer!.id });
    const res = await post<BatchCashoutResponse>(t, session, '/v1/cards/cashout-many', {
      cardIds: dropped.map((c) => c.id),
      toCardId: payer!.id,
    });
    expect(res.body.wallet).toBeNull();
    expect(res.body.toCard?.balance).toBe(Number(before) - 200_000 + res.body.payout);
  });

  it('keeps a batch in the holder, all or nothing', async () => {
    const session = await veteran();
    const four = await spinMany(session, 4);
    expect(
      (await post(t, session, '/v1/cards/hold-many', { cardIds: four.map((c) => c.id) })).status,
    ).toBe(200);
    const holder = (
      await t.app.inject({ url: '/v1/cards', headers: session.auth })
    ).json<HolderView>();
    expect(holder.slots.used).toBe(4);
    await fund(t, session.userId, 'RUB', 1_000_000n);
    const two = await spinMany(session, 2);
    const full = await post<ErrorBody>(t, session, '/v1/cards/hold-many', {
      cardIds: two.map((c) => c.id),
    });
    expect(full.body.error.code).toBe('HOLDER_FULL');
    expect(
      await t.prisma.card.count({
        where: { id: { in: two.map((c) => c.id) }, heldAt: { not: null } },
      }),
    ).toBe(0);
  });

  it('transfers between wallet and cards with the configured fees', async () => {
    const session = await veteran();
    const [a, b] = await spinMany(session, 2);
    await post(t, session, '/v1/cards/hold-many', { cardIds: [a!.id, b!.id] });
    const transfer = (from: object, to: object, amount: number) =>
      post<TransferResponse & ErrorBody>(t, session, '/v1/transfers', { from, to, amount });

    const topup = await transfer({ type: 'wallet' }, { type: 'card', cardId: a!.id }, 100_000);
    expect(topup.body).toMatchObject({
      amount: 100_000,
      fee: 0,
      received: 100_000,
      wallet: { balance: 200_000 },
    });

    const toCard = await transfer(
      { type: 'card', cardId: a!.id },
      { type: 'card', cardId: b!.id },
      50_000,
    );
    expect(toCard.body).toMatchObject({ fee: 500, received: 49_500 });

    const toWallet = await transfer({ type: 'card', cardId: a!.id }, { type: 'wallet' }, 10_000);
    expect(toWallet.body).toMatchObject({
      fee: 1000,
      received: 9000,
      wallet: { balance: 209_000 },
    });

    expect((await transfer({ type: 'wallet' }, { type: 'wallet' }, 100)).body.error.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      (await transfer({ type: 'card', cardId: a!.id }, { type: 'card', cardId: a!.id }, 100)).body
        .error.code,
    ).toBe('VALIDATION_FAILED');
    expect(
      (await transfer({ type: 'card', cardId: b!.id }, { type: 'wallet' }, 999_999_999)).body.error
        .code,
    ).toBe('INSUFFICIENT_FUNDS');
    await t.prisma.card.update({ where: { id: b!.id }, data: { heldAt: null } });
    expect(
      (await transfer({ type: 'card', cardId: b!.id }, { type: 'wallet' }, 100)).body.error.code,
    ).toBe('CARD_NOT_USABLE');
    expect(await rub(session.userId)).toBe(209_000n);
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });
});
