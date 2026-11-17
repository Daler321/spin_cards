import { DEFAULT_GAME_CONFIG } from '@spincards/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conversionFee, convertMinor } from '../src/wallet/exchange-rate.service.js';
import { createTestApp, idempotencyKey, login, type Session, type TestApp } from './support/app.js';

describe('conversion math', () => {
  it('converts minor units with the nano rate, rounding down', () => {
    expect(convertMinor(97_000n, 1_000_000_000n / 90n, 2, 2)).toBe(1077n);
    expect(convertMinor(1077n, 90_000_000_000n, 2, 2)).toBe(96_930n);
    expect(convertMinor(100n, 1_000_000_000n, 2, 0)).toBe(1n);
  });

  it('charges max(minimum fee, ceil(3%))', () => {
    expect(conversionFee(100_000n, 300, 1000n)).toBe(3000n);
    expect(conversionFee(10_000n, 300, 1000n)).toBe(1000n);
    expect(conversionFee(100_001n, 300, 0n)).toBe(3001n);
  });
});

describe('POST /v1/wallet/convert', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  const convert = (session: Session, body: Record<string, unknown>) =>
    t.app.inject({
      method: 'POST',
      url: '/v1/wallet/convert',
      headers: session.auth,
      payload: body,
    });

  it('converts RUB to USD with a fee through the ledger', async () => {
    const session = await login(t);
    const res = await convert(session, {
      from: 'RUB',
      to: 'USD',
      amount: 100_000,
      idempotencyKey: idempotencyKey(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      from: 'RUB',
      to: 'USD',
      amountFrom: 100_000,
      fee: 3000,
      amountTo: 1077,
      wallets: [
        { currency: 'RUB', balance: 400_000 },
        { currency: 'USD', balance: 1077 },
      ],
    });
    const reasons = await t.prisma.ledgerEntry.findMany({
      where: { userId: session.userId, refType: 'conversion' },
      orderBy: { id: 'asc' },
      select: { reason: true, delta: true, currency: true },
    });
    expect(reasons).toEqual([
      { reason: 'convert_out', delta: -100_000n, currency: 'RUB' },
      { reason: 'convert_in', delta: 1077n, currency: 'USD' },
    ]);
  });

  it('replays the stored response for a repeated key and applies it once', async () => {
    const session = await login(t);
    const body = { from: 'RUB', to: 'USD', amount: 50_000, idempotencyKey: idempotencyKey() };
    const first = await convert(session, body);
    const second = await convert(session, body);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(await t.prisma.currencyConversion.count({ where: { userId: session.userId } })).toBe(1);
  });

  it('rejects a reused key with a different body', async () => {
    const session = await login(t);
    const key = idempotencyKey();
    await convert(session, { from: 'RUB', to: 'USD', amount: 50_000, idempotencyKey: key });
    const res = await convert(session, {
      from: 'RUB',
      to: 'USD',
      amount: 60_000,
      idempotencyKey: key,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it('enforces the minimum amount, funds, validation and the daily limit', async () => {
    const session = await login(t);
    const key = idempotencyKey;

    const small = await convert(session, {
      from: 'RUB',
      to: 'USD',
      amount: 9_999,
      idempotencyKey: key(),
    });
    expect(small.json()).toMatchObject({ error: { code: 'CONVERSION_BELOW_MINIMUM' } });

    const tooMuch = await convert(session, {
      from: 'RUB',
      to: 'USD',
      amount: 500_001,
      idempotencyKey: key(),
    });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json()).toMatchObject({ error: { code: 'INSUFFICIENT_FUNDS' } });

    const same = await convert(session, {
      from: 'RUB',
      to: 'RUB',
      amount: 10_000,
      idempotencyKey: key(),
    });
    expect(same.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const fraction = await convert(session, {
      from: 'RUB',
      to: 'USD',
      amount: 100.5,
      idempotencyKey: key(),
    });
    expect(fraction.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    // Pretend most of today's limit is already used (100 ₽ under the default daily limit).
    const dailyLimit = BigInt(DEFAULT_GAME_CONFIG.conversion.dailyLimit.RUB);
    const rate = await t.prisma.exchangeRate.findFirstOrThrow({ where: { fromCurrency: 'RUB' } });
    await t.prisma.currencyConversion.create({
      data: {
        userId: session.userId,
        fromCurrency: 'RUB',
        toCurrency: 'USD',
        amountFrom: dailyLimit - 10_000n,
        fee: 0n,
        amountTo: 1n,
        rateNano: rate.rateNano,
        rateId: rate.id,
      },
    });
    const limited = await convert(session, {
      from: 'RUB',
      to: 'USD',
      amount: 20_000,
      idempotencyKey: key(),
    });
    expect(limited.json()).toMatchObject({ error: { code: 'CONVERSION_LIMIT_EXCEEDED' } });
  });

  it('lists wallet history newest first with a cursor', async () => {
    const session = await login(t);
    for (let i = 0; i < 3; i++) {
      await convert(session, {
        from: 'RUB',
        to: 'USD',
        amount: 10_000,
        idempotencyKey: idempotencyKey(),
      });
    }
    const page1 = await t.app.inject({ url: '/v1/wallet/history?limit=4', headers: session.auth });
    const body1 = page1.json<{
      items: { reason: string; currency: string }[];
      nextCursor: string;
    }>();
    expect(body1.items).toHaveLength(4);
    expect(body1.items[0]).toMatchObject({ reason: 'convert_in', currency: 'USD' });
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await t.app.inject({
      url: `/v1/wallet/history?limit=4&cursor=${body1.nextCursor}`,
      headers: session.auth,
    });
    const body2 = page2.json<{ items: { reason: string }[]; nextCursor: string | null }>();
    expect(body2.items.map((i) => i.reason)).toEqual(['convert_in', 'convert_out', 'signup_bonus']);
    expect(body2.nextCursor).toBeNull();

    const rubOnly = await t.app.inject({
      url: '/v1/wallet/history?currency=RUB',
      headers: session.auth,
    });
    expect(
      rubOnly.json<{ items: { currency: string }[] }>().items.every((i) => i.currency === 'RUB'),
    ).toBe(true);

    // D-122: filters by group of operations and by period.
    const reasons = async (query: string) =>
      (await t.app.inject({ url: `/v1/wallet/history?${query}`, headers: session.auth }))
        .json<{ items: { reason: string }[] }>()
        .items.map((i) => i.reason);
    expect(new Set(await reasons('group=exchange'))).toEqual(
      new Set(['convert_in', 'convert_out']),
    );
    expect(await reasons('group=bonuses')).toEqual(['signup_bonus']);
    expect(await reasons('group=spins')).toEqual([]);
    expect(await reasons('group=exchange&currency=USD&days=1')).toEqual([
      'convert_in',
      'convert_in',
      'convert_in',
    ]);
    const invalid = await t.app.inject({
      url: '/v1/wallet/history?days=3',
      headers: session.auth,
    });
    expect(invalid.statusCode).toBe(400);
  });
});
