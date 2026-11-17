import { randomUUID } from 'node:crypto';
import type {
  PreCheckoutResponse,
  SpinResponse,
  StarsInvoiceResponse,
  SuccessfulPaymentResponse,
} from '@spincards/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import {
  createTestApp,
  fund,
  login,
  nextTelegramId,
  patchFlags,
  post,
  type Session,
  type TestApp,
} from './support/app.js';
import { TEST_INTERNAL_TOKEN } from './support/env.js';

type ErrorBody = { error: { code: string } };

/** D-146: Telegram Stars products of the economy config. */
describe('Stars catalog (D-146)', () => {
  let t: TestApp;
  const telegram = vi.fn((url: string, _init?: RequestInit) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          result: url.includes('createInvoiceLink') ? 'https://t.me/$invoice' : true,
        }),
        { status: 200 },
      ),
    ),
  );

  beforeAll(async () => {
    t = await createTestApp();
    patchFlags(t, { stars_enabled: true });
  });
  afterAll(() => t.close());
  beforeEach(() => {
    telegram.mockClear();
    vi.stubGlobal('fetch', telegram);
  });

  const internal = async <T>(url: string, payload: object) => {
    const res = await t.app.inject({
      method: 'POST',
      url,
      headers: { 'x-internal-token': TEST_INTERNAL_TOKEN },
      payload,
    });
    return res.json<T>();
  };

  /** Invoice, pre-checkout and the bot's successful_payment, as Telegram would run them. */
  const buy = async (
    player: { session: Session; telegramId: number },
    productId: string,
    cardId?: string,
  ) => {
    const invoice = await post<StarsInvoiceResponse & ErrorBody>(
      t,
      player.session,
      '/v1/payments/stars/invoice',
      { productId, ...(cardId && { cardId }) },
    );
    if (invoice.status !== 200) return { invoice, check: null, paid: null };
    const payment = await t.prisma.payment.findUniqueOrThrow({
      where: { id: invoice.body.paymentId },
    });
    const base = {
      telegramId: String(player.telegramId),
      payload: invoice.body.paymentId,
      currency: 'XTR',
      totalAmount: payment.starsAmount,
    };
    const check = await internal<PreCheckoutResponse>('/internal/bot/payments/pre-checkout', base);
    const paid = await internal<SuccessfulPaymentResponse>('/internal/bot/payments/success', {
      ...base,
      telegramPaymentChargeId: `charge-${randomUUID()}`,
    });
    return { invoice, check, paid, stars: payment.starsAmount };
  };

  const player = async () => {
    const telegramId = nextTelegramId();
    return { telegramId, session: await login(t, { telegramId }) };
  };

  const heldCard = async (session: Session) => {
    const spin = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    const card = spin.body.spins[0]!.card;
    await post(t, session, `/v1/cards/${card.id}/hold`);
    return card;
  };

  it('sells luck multipliers for an hour without a limit; buying again adds time (D-147)', async () => {
    const p = await player();
    for (let i = 0; i < 3; i++) {
      const { check, paid } = await buy(p, 'buff:x1_5');
      expect(check).toEqual({ ok: true });
      expect(paid).toMatchObject({ credited: true });
    }
    const buffs = await t.prisma.userBuff.findMany({
      where: { userId: p.session.userId },
      orderBy: { expiresAt: 'asc' },
    });
    expect(buffs).toHaveLength(3);
    expect(buffs.every((b) => b.source === 'stars' && b.multiplierBp === 15_000)).toBe(true);
    expect(buffs.every((b) => b.spinsLeft === null)).toBe(true);
    // Each purchase starts where the last one ends: about three hours in all.
    const last = buffs[2]!.expiresAt!.getTime();
    expect(last - Date.now()).toBeGreaterThan(2.9 * 3_600_000);
    const invoice = JSON.parse(telegram.mock.calls[0]?.[1]?.body as string) as {
      title: string;
      prices: { amount: number }[];
    };
    expect(invoice.title).toBe('Удача ×1,5 на 60 мин');
    expect(invoice.prices[0]?.amount).toBe(15);
  });

  it('resets the spin limit of a held card', async () => {
    const p = await player();
    const card = await heldCard(p.session);
    // Nothing used yet: nothing to reset.
    const none = await buy(p, 'card_limit_reset', card.id);
    expect(none.invoice.body.error.code).toBe('CARD_NOT_USABLE');
    await t.prisma.card.update({
      where: { id: card.id },
      data: { spinWindowStartedAt: new Date(), spinsInWindow: 500 },
    });
    const { paid } = await buy(p, 'card_limit_reset', card.id);
    expect(paid).toMatchObject({ credited: true });
    expect(await t.prisma.card.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({
      spinsInWindow: 0,
      spinWindowStartedAt: null,
    });
  });

  it('puts a card into the album for Stars: its balance to the wallet, no money price', async () => {
    const p = await player();
    const card = await heldCard(p.session);
    const wallet = () =>
      t.prisma.wallet.findUniqueOrThrow({
        where: { userId_currency: { userId: p.session.userId, currency: 'RUB' } },
      });
    const before = (await wallet()).balance;
    const { paid, stars } = await buy(p, 'trophy', card.id);
    expect(paid).toMatchObject({ credited: true });
    expect(stars).toBeGreaterThan(0);
    expect(await t.prisma.card.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({
      status: 'trophy',
      balance: 0n,
    });
    expect((await wallet()).balance).toBe(before + BigInt(card.cashoutValue));
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('opens a holder before its level, and an extra album slot', async () => {
    const p = await player();
    expect((await buy(p, 'holder:gold')).paid).toMatchObject({ credited: true });
    expect(
      await t.prisma.userHolder.count({ where: { userId: p.session.userId, holderId: 'gold' } }),
    ).toBe(1);
    const again = await buy(p, 'holder:gold');
    expect(again.invoice.body.error.code).toBe('HOLDER_ALREADY_OWNED');

    await buy(p, 'album_slot');
    await buy(p, 'album_slot');
    expect(
      (await t.prisma.user.findUniqueOrThrow({ where: { id: p.session.userId } })).showcaseSlots,
    ).toBe(2);
  });

  it('refunds the Stars when the product cannot be given any more', async () => {
    const p = await player();
    await fund(t, p.session.userId, 'RUB', 10_000_000n);
    const card = await heldCard(p.session);
    const invoice = await post<StarsInvoiceResponse>(t, p.session, '/v1/payments/stars/invoice', {
      productId: 'trophy',
      cardId: card.id,
    });
    const payment = await t.prisma.payment.findUniqueOrThrow({
      where: { id: invoice.body.paymentId },
    });
    // The card is cashed out while the payment form is open.
    await post(t, p.session, `/v1/cards/${card.id}/cashout`);
    const paid = await internal<SuccessfulPaymentResponse>('/internal/bot/payments/success', {
      telegramId: String(p.telegramId),
      payload: payment.id,
      currency: 'XTR',
      totalAmount: payment.starsAmount,
      telegramPaymentChargeId: `charge-${randomUUID()}`,
    });
    expect(paid).toMatchObject({ credited: false, refunded: true });
    expect(telegram.mock.calls.some(([url]) => url.includes('refundStarPayment'))).toBe(true);
    expect(await t.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({
      status: 'refunded',
    });
  });

  it('refuses unknown products and card products without a card', async () => {
    const p = await player();
    expect((await buy(p, 'buff:huge')).invoice.body.error.code).toBe('PRODUCT_NOT_FOUND');
    expect((await buy(p, 'trophy')).invoice.body.error.code).toBe('CARD_NOT_FOUND');
  });
});
