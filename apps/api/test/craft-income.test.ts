import {
  type AlbumIncomeClaimResponse,
  type AlbumResponse,
  type CollectResponse,
  type CraftResponse,
  type MeResponse,
  type NickBonusClaimResponse,
  type SpinResponse,
  TIERS,
} from '@spincards/shared';
import { randomUUID } from 'node:crypto';
import { cardBalance, numberMultBp, type PatternMatch } from '@spincards/game-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CardsService } from '../src/game/cards.service.js';
import { NickCheckService } from '../src/game/nick-check.service.js';
import { FlagsService } from '../src/game-config/flags.service.js';
import { GameConfigService } from '../src/game-config/game-config.service.js';
import { SeasonService } from '../src/game-config/season.service.js';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import { TelegramApiService } from '../src/payments/telegram-api.service.js';
import {
  createTestApp,
  fund,
  get,
  login,
  patchFlags,
  post,
  type Session,
  type TestApp,
} from './support/app.js';

type ErrorBody = { error: { code: string } };
const HOUR = 3_600_000;

describe('auto-sell, collect, craft, upgrade, album income, nick bonus (D-170..D-175)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    patchFlags(t, { craft_enabled: true, album_income_enabled: true, nick_bonus_enabled: true });
  });

  afterAll(() => t.close());

  const veteran = async (firstName?: string) => {
    const session = await login(t, firstName ? { firstName } : {});
    await t.prisma.user.update({ where: { id: session.userId }, data: { totalSpins: 10 } });
    await fund(t, session.userId, 'RUB', 50_000_000n);
    return session;
  };
  const spinMany = async (session: Session, count: number) =>
    (
      await post<SpinResponse>(t, session, '/v1/spin', {
        packId: 'basic',
        payment: { type: 'wallet' },
        count,
      })
    ).body.spins;
  const heldCards = async (session: Session, count: number) => {
    const cards = (await spinMany(session, count)).map((s) => s.card);
    await post(t, session, '/v1/cards/hold-many', { cardIds: cards.map((c) => c.id) });
    return cards;
  };
  const rub = async (userId: string) =>
    (
      await t.prisma.wallet.findUniqueOrThrow({
        where: { userId_currency: { userId, currency: 'RUB' } },
      })
    ).balance;

  it('auto-sells dropped cards of the chosen tiers', async () => {
    const session = await veteran();
    const saved = await t.app.inject({
      method: 'POST',
      url: '/v1/settings',
      headers: session.auth,
      payload: { autoCashoutTiers: [...TIERS] },
    });
    expect(saved.statusCode).toBe(204);
    const me = await get<MeResponse>(t, session, '/v1/me');
    expect(me.settings.autoCashoutTiers).toEqual([...TIERS]);

    const spins = await spinMany(session, 3);
    for (const spin of spins)
      expect(spin.autoCashedOut).toEqual({ payout: spin.card.cashoutValue, toCardId: null });
    const ids = spins.map((s) => s.card.id);
    expect(await t.prisma.card.count({ where: { id: { in: ids }, status: 'pooled' } })).toBe(3);
    expect((await get<MeResponse>(t, session, '/v1/me')).game.pendingCardId).toBeNull();
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('auto-sells onto the card that paid for the spin (D-178)', async () => {
    const session = await veteran();
    const [payer] = await heldCards(session, 1);
    await post(t, session, '/v1/transfers', {
      from: { type: 'wallet' },
      to: { type: 'card', cardId: payer!.id },
      amount: 5_000_000,
    });
    await t.prisma.user.update({
      where: { id: session.userId },
      data: { autoCashoutTiers: [...TIERS] },
    });
    const walletBefore = await rub(session.userId);
    const res = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'card', cardId: payer!.id },
      count: 2,
    });
    expect(res.status).toBe(200);
    const payouts = res.body.spins.reduce((sum, s) => sum + (s.autoCashedOut?.payout ?? 0), 0);
    for (const spin of res.body.spins) expect(spin.autoCashedOut?.toCardId).toBe(payer!.id);
    const card = await t.prisma.card.findUniqueOrThrow({ where: { id: payer!.id } });
    expect(res.body.paymentCard?.balance).toBe(Number(card.balance));
    expect(await rub(session.userId)).toBe(walletBefore);
    expect(payouts).toBeGreaterThan(0);
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('collects every other card onto one card or the wallet', async () => {
    const session = await veteran();
    const [target, ...others] = await heldCards(session, 3);
    const balances = others.map((c) => c.balance);
    const res = await post<CollectResponse>(t, session, '/v1/transfers/collect', {
      currency: 'RUB',
      to: { type: 'card', cardId: target!.id },
    });
    expect(res.status).toBe(200);
    expect(res.body.cards).toBe(2);
    expect(res.body.amount).toBe(balances.reduce((a, b) => a + b, 0));
    const row = await t.prisma.card.findUniqueOrThrow({ where: { id: target!.id } });
    expect(Number(row.balance)).toBe(target!.balance + res.body.received);

    const before = await rub(session.userId);
    const toWallet = await post<CollectResponse>(t, session, '/v1/transfers/collect', {
      currency: 'RUB',
      to: { type: 'wallet' },
    });
    expect(toWallet.body.cards).toBe(1);
    expect(await rub(session.userId)).toBe(before + BigInt(toWallet.body.received));
    const empty = await post<ErrorBody>(t, session, '/v1/transfers/collect', {
      currency: 'RUB',
      to: { type: 'wallet' },
    });
    expect(empty.body.error.code).toBe('NOTHING_TO_COLLECT');
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('crafts four cards of one tier into one, used cards leave the game', async () => {
    const session = await veteran();
    const cards = await heldCards(session, 4);
    const ids = cards.map((c) => c.id);
    await t.prisma.card.updateMany({ where: { id: { in: ids } }, data: { tier: 'common' } });

    const few = await post<ErrorBody>(t, session, '/v1/cards/craft', { cardIds: ids.slice(0, 3) });
    expect(few.body.error.code).toBe('CRAFT_INVALID_CARDS');

    const res = await post<CraftResponse>(t, session, '/v1/cards/craft', { cardIds: ids });
    expect(res.status).toBe(200);
    expect(res.body.card.held).toBe(true);
    if (res.body.card.tier !== 'mythic')
      expect(res.body.card.tier).toBe(res.body.success ? 'rare' : 'common');
    expect(await t.prisma.card.count({ where: { id: { in: ids }, status: 'crafted' } })).toBe(4);
    const craft = await t.prisma.cardCraft.findFirstOrThrow({ where: { userId: session.userId } });
    expect(craft).toMatchObject({ tier: 'common', resultCardId: res.body.card.id });
    expect(res.body.fee).toBe(Number(craft.fee));

    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('refuses a craft while the flag is off', async () => {
    const session = await veteran();
    patchFlags(t, { craft_enabled: false });
    const res = await post<ErrorBody>(t, session, '/v1/cards/craft', {
      cardIds: [randomUUID(), randomUUID()],
    });
    patchFlags(t, { craft_enabled: true });
    expect(res.body.error.code).toBe('NOT_AVAILABLE');
  });

  it('upgrades a card one tier for Stars: same number, more balance', async () => {
    const session = await veteran();
    const [card] = await heldCards(session, 1);
    const { config } = await t.app.get(GameConfigService).active();
    // A Common card valued as Common (the drop may have been any tier).
    const dropped = await t.prisma.card.findUniqueOrThrow({ where: { id: card!.id } });
    const common = BigInt(
      cardBalance(
        Number(dropped.baseLimit),
        config.tiers.common.designMultBp,
        numberMultBp(dropped.numberPatterns as unknown as PatternMatch[], config),
      ),
    );
    await t.prisma.card.update({
      where: { id: card!.id },
      data: { tier: 'common', initialBalance: common },
    });
    const seasonId = await t.app.get(SeasonService).currentSeasonId();
    const before = await t.prisma.card.findUniqueOrThrow({ where: { id: card!.id } });
    await t.prisma.transaction((tx) =>
      t.app
        .get(CardsService)
        .applyStarsCard(tx, session.userId, 'card_upgrade', card!.id, config, seasonId, new Date()),
    );
    const after = await t.prisma.card.findUniqueOrThrow({ where: { id: card!.id } });
    expect(after.tier).toBe('rare');
    expect(after.number).toBe(before.number);
    expect(after.balance - before.balance).toBe(after.initialBalance - before.initialBalance);
    expect(after.balance > before.balance).toBe(true);
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('pays album income once per interval', async () => {
    const session = await veteran();
    const [card] = await heldCards(session, 1);
    expect((await post(t, session, `/v1/cards/${card!.id}/trophy`)).status).toBe(200);
    const album = await get<AlbumResponse>(t, session, '/v1/album');
    const { config } = await t.app.get(GameConfigService).active();
    const expected = config.albumIncome?.perTier[card!.tier].RUB ?? 0;
    expect(album.income).toEqual({ amount: expected, currency: 'RUB', availableAt: null });

    const before = await rub(session.userId);
    const res = await post<AlbumIncomeClaimResponse>(t, session, '/v1/bonus/album/claim');
    expect(res.body.amount).toBe(expected);
    expect(await rub(session.userId)).toBe(before + BigInt(expected));
    const again = await post<ErrorBody>(t, session, '/v1/bonus/album/claim');
    expect(again.body.error.code).toBe('ALBUM_INCOME_NOT_READY');

    await t.prisma.user.update({
      where: { id: session.userId },
      data: { albumIncomeAt: new Date(Date.now() - 9 * HOUR) },
    });
    expect((await post(t, session, '/v1/bonus/album/claim')).status).toBe(200);
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('gives the name tag bonus once a day while the tag is in the name', async () => {
    const plain = await veteran();
    const none = await post<ErrorBody>(t, plain, '/v1/bonus/nick/claim');
    expect(none.body.error.code).toBe('NICK_TAG_MISSING');

    const session = await veteran('Вася @SpinCards_bot');
    const me = await get<MeResponse>(t, session, '/v1/me');
    expect(me.game.nickBonus).toMatchObject({ hasTag: true, availableAt: null });
    const freeBefore = me.game.freeSpins.available;
    const res = await post<NickBonusClaimResponse>(t, session, '/v1/bonus/nick/claim');
    expect(res.status).toBe(200);
    expect(res.body.freeSpins).toBe(4);
    // D-178: 30 000 ₽ as is, and the next spin is Epic or better.
    expect(res.body.credited).toEqual({ currency: 'RUB', amount: 3_000_000 });
    const user = await t.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(user.guaranteedFloor).toBe('epic');
    expect((await get<MeResponse>(t, session, '/v1/me')).game.freeSpins.available).toBe(
      freeBefore + 4,
    );
    const again = await post<ErrorBody>(t, session, '/v1/bonus/nick/claim');
    expect(again.body.error.code).toBe('NICK_BONUS_NOT_READY');
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('the worker re-reads names and drops a removed tag', async () => {
    const session = await veteran('Петя @SpinCards_bot');
    await t.prisma.user.update({
      where: { id: session.userId },
      data: { nickCheckedAt: new Date(Date.now() - 5 * HOUR) },
    });
    const telegram = t.app.get(TelegramApiService);
    telegram.getChatName = () => Promise.resolve({ firstName: 'Петя', lastName: null });
    const job = new NickCheckService(
      t.prisma,
      t.app.get(GameConfigService),
      t.app.get(FlagsService),
      telegram,
    );
    await job.run();
    const user = await t.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(user.nickHasTag).toBe(false);
  });
});
