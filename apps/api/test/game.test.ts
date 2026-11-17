import { GameConfigService } from '../src/game-config/game-config.service.js';
import { TEST_STARTER_SLOTS } from './support/global-setup.js';
import { lifecyclePrices, DEFAULT_GAME_CONFIG } from '@spincards/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CardView, SpinItem, SpinResponse } from '@spincards/shared';
import { LifecycleService } from '../src/game/lifecycle.service.js';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import {
  createTestApp,
  fund,
  idempotencyKey,
  login,
  patchConfig,
  patchFlags,
  post,
  type Session,
  type TestApp,
} from './support/app.js';

type ErrorBody = { error: { code: string } };

/** Free holder slots (pinned for the tests) and the leather holder's, from the default config. */
const freeSlots = TEST_STARTER_SLOTS;
const leatherSlots = DEFAULT_GAME_CONFIG.holders.find((h) => h.id === 'leather')!.slots;

describe('game API', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  /** Single spins: the only item of the batch is flattened into the body for brevity. */
  const spin = async (session: Session, payload: Record<string, unknown> = {}) => {
    const res = await post<SpinResponse & ErrorBody>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
      ...payload,
    });
    const body = {
      ...res.body,
      ...((res.body.spins as SpinItem[] | undefined)?.[0] ?? {}),
    } as SpinResponse & SpinItem & ErrorBody;
    return { status: res.status, body };
  };
  const hold = (session: Session, cardId: string) =>
    post<{ card: CardView } & ErrorBody>(t, session, `/v1/cards/${cardId}/hold`);
  const wallet = async (userId: string, currency = 'RUB') =>
    (await t.prisma.wallet.findUniqueOrThrow({ where: { userId_currency: { userId, currency } } }))
      .balance;

  describe('spin', () => {
    it('charges the wallet, issues the card through the ledger and records the spin', async () => {
      const session = await login(t);
      const { status, body } = await spin(session);
      expect(status).toBe(200);
      // D-116: the starter luck stays on the server.
      expect(body).not.toHaveProperty('newbieStep');
      expect(body.card).toMatchObject({
        tier: 'rare',
        currency: 'RUB',
        status: 'active',
        held: false,
        ownersCount: 1,
      });
      expect(body.card.number).toMatch(/^9\d{15}$/);
      expect(body.wallets).toContainEqual({ currency: 'RUB', balance: 400_000 });
      expect(body.exp).toMatchObject({ gained: 10 + 2, level: 1 });

      const card = await t.prisma.card.findUniqueOrThrow({ where: { id: body.card.id } });
      expect(card.balance).toBe(card.initialBalance);
      const issue = await t.prisma.ledgerEntry.findFirstOrThrow({
        where: { accountId: card.id, reason: 'card_issue' },
      });
      expect(issue.delta).toBe(card.balance);
      const row = await t.prisma.spin.findUniqueOrThrow({ where: { id: body.spinId } });
      expect(row).toMatchObject({
        paymentSource: 'wallet',
        price: 100_000n,
        currency: 'RUB',
        cardId: card.id,
      });
      // A newcomer with 5 000 ₽: the newbie boost (×4) beats the low-balance one (×2).
      expect(row.rolledParams).toMatchObject({ newbieStep: 0, hiddenBoostBp: 30_000 });
      expect(await findLedgerMismatches(t.prisma)).toEqual([]);
    });

    it('blocks the next spin until the dropped card is decided', async () => {
      const session = await login(t);
      const first = await spin(session);
      const blocked = await spin(session);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('CARD_DECISION_PENDING');
      expect((await hold(session, first.body.card.id)).status).toBe(200);
      expect((await spin(session)).status).toBe(200);
    });

    it('replays a spin for a repeated idempotency key and charges once', async () => {
      const session = await login(t);
      const key = idempotencyKey();
      const a = await spin(session, { idempotencyKey: key });
      const b = await spin(session, { idempotencyKey: key });
      expect(b.body).toEqual(a.body);
      expect(await t.prisma.spin.count({ where: { userId: session.userId } })).toBe(1);
      expect(await wallet(session.userId)).toBe(400_000n);
    });

    it('spends free spins of the free pack and stops at zero', async () => {
      const session = await login(t);
      const results: number[] = [];
      for (let i = 0; i < 4; i++) {
        const { status, body } = await spin(session, { packId: 'free' });
        results.push(status);
        if (status === 200) await hold(session, body.card.id);
        else expect(body.error.code).toBe('NO_FREE_SPINS');
      }
      expect(results).toEqual([200, 200, 200, 409]);
      expect(await wallet(session.userId)).toBe(500_000n);
    });

    it('locks packs below their unlock level', async () => {
      const session = await login(t);
      const { status, body } = await spin(session, { packId: 'business' });
      expect(status).toBe(403);
      expect(body.error.code).toBe('PACK_LOCKED');
      expect((await spin(session, { packId: 'vip' })).body.error.code).toBe('PACK_NOT_AVAILABLE');
    });

    it('pays with a held card and adds its luck bonus', async () => {
      const session = await login(t);
      const first = await spin(session);
      await hold(session, first.body.card.id);
      await post(t, session, `/v1/cards/${first.body.card.id}/topup`, { amount: 200_000 });
      const before = (await t.prisma.card.findUniqueOrThrow({ where: { id: first.body.card.id } }))
        .balance;

      const paid = await spin(session, { payment: { type: 'card', cardId: first.body.card.id } });
      expect(paid.status).toBe(200);
      expect(paid.body.paymentCard).toEqual({
        id: first.body.card.id,
        balance: Number(before) - 100_000,
      });
      const row = await t.prisma.spin.findUniqueOrThrow({ where: { id: paid.body.spinId } });
      expect(row.paymentSource).toBe('card');
      // D-147: the spin was played with the card's luck points.
      expect((row.rolledParams as { luckPoints: number }).luckPoints).toBeGreaterThanOrEqual(
        first.body.card.luckPoints,
      );
    });

    it('counts the luck of a held card by the active config, not the stored one (D-138)', async () => {
      const session = await login(t);
      const first = await spin(session);
      await hold(session, first.body.card.id);
      await post(t, session, `/v1/cards/${first.body.card.id}/topup`, { amount: 200_000 });
      // A card dropped under an older config keeps a stale value in its row.
      await t.prisma.card.update({ where: { id: first.body.card.id }, data: { luckBonusBp: 99 } });
      const holder = (await t.app.inject({ url: '/v1/cards', headers: session.auth })).json<{
        cards: CardView[];
      }>();
      const view = holder.cards.find((c) => c.id === first.body.card.id)!;
      expect(view.luckPoints).toBe(first.body.card.luckPoints);

      const paid = await spin(session, { payment: { type: 'card', cardId: first.body.card.id } });
      const row = await t.prisma.spin.findUniqueOrThrow({ where: { id: paid.body.spinId } });
      expect((row.rolledParams as { luckPoints: number }).luckPoints).toBeGreaterThanOrEqual(
        view.luckPoints,
      );
    });

    it('limits the spins one holder card can pay for per window (D-121)', async () => {
      const session = await login(t);
      const first = await spin(session);
      await hold(session, first.body.card.id);
      await post(t, session, `/v1/cards/${first.body.card.id}/topup`, { amount: 300_000 });
      const cardId = first.body.card.id;
      const window = (startedAt: Date, used: number) =>
        t.prisma.card.update({
          where: { id: cardId },
          data: { spinWindowStartedAt: startedAt, spinsInWindow: used },
        });
      const payWith = (count: number) =>
        spin(session, { payment: { type: 'card', cardId }, count });
      // The dropped card blocks the next spin until it is decided.
      const settle = async (res: Awaited<ReturnType<typeof spin>>) => {
        for (const item of res.body.spins)
          await post(t, session, `/v1/cards/${item.card.id}/cashout`);
      };

      const limit = DEFAULT_GAME_CONFIG.cardSpinLimit.spins;
      await window(new Date(), limit - 1);
      const two = await payWith(2);
      expect(two.status).toBe(409);
      expect(two.body.error.code).toBe('CARD_SPIN_LIMIT');
      const one = await payWith(1);
      expect(one.status).toBe(200);
      await settle(one);
      const card = await t.prisma.card.findUniqueOrThrow({ where: { id: cardId } });
      expect(card.spinsInWindow).toBe(limit);
      expect((await payWith(1)).body.error.code).toBe('CARD_SPIN_LIMIT');

      // The wallet has no limit; a window older than 12 hours starts over.
      const fromWallet = await spin(session);
      expect(fromWallet.status).toBe(200);
      await settle(fromWallet);
      await window(new Date(Date.now() - 13 * 3600_000), limit);
      const again = await payWith(1);
      expect(again.status).toBe(200);
      expect((await t.prisma.card.findUniqueOrThrow({ where: { id: cardId } })).spinsInWindow).toBe(
        1,
      );
    });

    it('rejects cards that cannot pay', async () => {
      const session = await login(t);
      const other = await login(t);
      const own = await spin(session);
      const foreign = await spin(other);
      await hold(session, own.body.card.id);
      const payWith = (cardId: string) => spin(session, { payment: { type: 'card', cardId } });

      expect((await payWith(foreign.body.card.id)).body.error.code).toBe('CARD_NOT_FOUND');
      // A newbie Rare card from Basic is usually worth less than the 1 000 ₽ price.
      if (own.body.card.balance < 100_000) {
        expect((await payWith(own.body.card.id)).body.error.code).toBe('INSUFFICIENT_FUNDS');
      }
      // A RUB card cannot pay for a spin in the US region (USD).
      await t.app.inject({
        method: 'POST',
        url: '/v1/me/region',
        headers: session.auth,
        payload: { region: 'US' },
      });
      expect((await payWith(own.body.card.id)).body.error.code).toBe('CARD_NOT_USABLE');
    });

    it('re-drops a pooled card with the same number and one more owner', async () => {
      // A new player's first spin is rare (newbie step); parallel test files re-drop pooled rare
      // cards too, so several go into the pool to keep one available for this spin.
      const seasonId = (await t.prisma.season.findFirstOrThrow()).id;
      await t.prisma.card.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          seasonId,
          bankId: 'ruby',
          region: 'RU' as const,
          currency: 'RUB',
          tier: 'rare' as const,
          number: `9${String(i)}${String(Date.now()).padStart(14, '7').slice(-14)}`,
          numberPatterns: [],
          rarityScore: 3,
          baseLimit: 1n,
          initialBalance: 1n,
          luckBonusBp: 0,
          status: 'pooled',
          ownersCount: 2,
          issuedAt: new Date('2000-01-01'),
          expiresAt: new Date('2000-01-02'),
          pooledAt: new Date('2000-01-01'),
        })),
      });
      const local = await createTestApp();
      try {
        await patchConfig(local, (c) => {
          c.pool.redropChanceBp = 10_000;
        });
        const session = await login(local);
        // The test DB is shared by parallel test files that pool and re-drop cards too: any pooled
        // card may be the one re-dropped (even one pooled a moment ago), so the check is that the
        // dropped card already existed, kept its number and gained exactly one owner.
        const pool = new Map((await local.prisma.card.findMany()).map((c) => [c.id, c]));
        const { body } = await post<SpinResponse>(local, session, '/v1/spin', {
          packId: 'basic',
          payment: { type: 'wallet' },
        });
        const dropped = body.spins[0]?.card;
        const before = dropped && pool.get(dropped.id);
        expect(before).toBeDefined();
        expect(dropped).toMatchObject({
          number: before?.number,
          bankId: before?.bankId,
          ownersCount: (before?.ownersCount ?? 0) + 1,
          tier: before?.tier,
        });
        const card = await local.prisma.card.findUniqueOrThrow({ where: { id: dropped?.id } });
        expect(card).toMatchObject({ ownerId: session.userId, status: 'active', pooledAt: null });
      } finally {
        await local.close();
      }
    });

    it('keeps card numbers unique under parallel spins', async () => {
      const sessions = await Promise.all(Array.from({ length: 20 }, () => login(t)));
      const results = await Promise.all(sessions.map((s) => spin(s)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      const numbers = results.map((r) => r.body.card.number);
      expect(new Set(numbers).size).toBe(numbers.length);
      const dupes = await t.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM (SELECT number FROM cards WHERE status IN ('active','expired')
        GROUP BY bank_id, tier, number HAVING count(*) > 1) d`;
      expect(dupes[0]?.n).toBe(0n);
    });

    it('lets a number repeat across banks and tiers, never within one (D-123)', async () => {
      const session = await login(t);
      const first = await spin(session);
      const card = await t.prisma.card.findUniqueOrThrow({ where: { id: first.body.card.id } });
      const { id: _id, ...copy } = card;
      const twin = (bankId: string, tier: typeof card.tier) =>
        t.prisma.card.create({
          data: {
            ...copy,
            bankId,
            tier,
            numberPatterns: card.numberPatterns ?? [],
            // No ledger entries: a zero balance keeps the books consistent for parallel tests.
            balance: 0n,
          },
        });
      const otherBank = ['lemon', 'azure', 'ruby', 'emerald'].find((b) => b !== card.bankId)!;
      const otherTier = card.tier === 'common' ? 'rare' : 'common';
      const a = await twin(otherBank, card.tier);
      const b = await twin(card.bankId, otherTier);
      await expect(twin(card.bankId, card.tier)).rejects.toMatchObject({ code: 'P2002' });
      await t.prisma.card.updateMany({
        where: { id: { in: [a.id, b.id] } },
        data: { status: 'cashed' },
      });
    });

    it('levels up from spin EXP', async () => {
      const session = await login(t);
      await t.prisma.user.update({ where: { id: session.userId }, data: { exp: 125 } });
      const { body } = await spin(session);
      expect(body.exp).toMatchObject({ level: 2, leveledUp: true });
    });

    it('hides the near-miss hint when near_miss_ux is off and rejects spins in maintenance', async () => {
      const local = await createTestApp();
      try {
        patchFlags(local, { near_miss_ux: false });
        const session = await login(local);
        expect(
          (
            await post<SpinResponse>(local, session, '/v1/spin', {
              packId: 'basic',
              payment: { type: 'wallet' },
            })
          ).body.spins[0]?.nearMiss,
        ).toBeNull();
        patchFlags(local, { maintenance_mode: true });
        const res = await post<ErrorBody>(local, session, '/v1/spin', {
          packId: 'basic',
          payment: { type: 'wallet' },
        });
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('MAINTENANCE');
      } finally {
        await local.close();
      }
    });
  });

  describe('cards', () => {
    it('cashes out minus the level fee and returns the card to the pool', async () => {
      const session = await login(t);
      const { body } = await spin(session);
      const balance = body.card.balance;
      const res = await post<{ payout: number; fee: number; wallet: { balance: number } }>(
        t,
        session,
        `/v1/cards/${body.card.id}/cashout`,
      );
      expect(res.status).toBe(200);
      expect(res.body.payout).toBe(Math.floor(balance * 0.9));
      expect(res.body.wallet.balance).toBe(400_000 + res.body.payout);
      const card = await t.prisma.card.findUniqueOrThrow({ where: { id: body.card.id } });
      expect(card).toMatchObject({ status: 'pooled', ownerId: null, balance: 0n });
      expect(
        (await post<ErrorBody>(t, session, `/v1/cards/${body.card.id}/cashout`)).body.error.code,
      ).toBe('CARD_NOT_FOUND');
      expect(await findLedgerMismatches(t.prisma)).toEqual([]);
    });

    it('lists the holder with slots and the pending card', async () => {
      const session = await login(t);
      const a = await spin(session);
      await hold(session, a.body.card.id);
      const b = await spin(session);
      const res = await t.app.inject({ url: '/v1/cards', headers: session.auth });
      expect(res.json()).toMatchObject({
        cards: [{ id: a.body.card.id, held: true }],
        pending: [{ id: b.body.card.id, held: false }],
        slots: { used: 1, total: freeSlots },
        ownedHolders: ['basic'],
        collection: { score: a.body.card.rarityScore, level: 1 },
      });
      const me = await t.app.inject({ url: '/v1/me', headers: session.auth });
      expect(me.json()).toMatchObject({
        game: { pendingCardId: b.body.card.id, freeSpins: { available: 3 } },
      });
    });

    it('extends an active card once for its rarity price, paid from the wallet', async () => {
      const session = await login(t);
      const { body } = await spin(session);
      await hold(session, body.card.id);
      const wallet = async () =>
        (
          await t.prisma.wallet.findUniqueOrThrow({
            where: { userId_currency: { userId: session.userId, currency: 'RUB' } },
          })
        ).balance;
      const before = await wallet();
      const res = await post<{ card: CardView }>(t, session, `/v1/cards/${body.card.id}/extend`);
      const { config } = await t.app.get(GameConfigService).active();
      const price = lifecyclePrices(body.card, 'RUB', config.lifecycle).extend;
      // The card keeps its balance; the wallet pays.
      expect(res.body.card.balance).toBe(body.card.balance);
      expect(await wallet()).toBe(before - BigInt(price));
      const hours =
        (Date.parse(res.body.card.expiresAt) - Date.parse(body.card.expiresAt)) / 3_600_000;
      expect(hours).toBe(60); // rare lives 120 h, +50%
      expect(
        (await post<ErrorBody>(t, session, `/v1/cards/${body.card.id}/extend`)).body.error.code,
      ).toBe('CARD_NOT_EXTENDABLE');
    });

    it('expires, restores and finally burns cards on schedule', async () => {
      const session = await login(t);
      const { body } = await spin(session);
      await hold(session, body.card.id);
      const lifecycle = t.app.get(LifecycleService);
      const past = new Date(Date.now() - 1000);
      await t.prisma.card.update({ where: { id: body.card.id }, data: { expiresAt: past } });

      await lifecycle.run(new Date());
      let card = await t.prisma.card.findUniqueOrThrow({ where: { id: body.card.id } });
      expect(card.status).toBe('expired');
      expect(card.graceUntil?.getTime()).toBe(past.getTime() + 72 * 3_600_000);
      expect(
        (
          await post<ErrorBody>(t, session, '/v1/spin', {
            packId: 'basic',
            payment: { type: 'card', cardId: card.id },
          })
        ).body.error.code,
      ).toBe('CARD_EXPIRED');

      const restored = await post<{ card: CardView }>(t, session, `/v1/cards/${card.id}/restore`);
      expect(restored.body.card).toMatchObject({ status: 'active', balance: Number(card.balance) });

      await t.prisma.card.update({
        where: { id: card.id },
        data: { status: 'expired', graceUntil: past },
      });
      await lifecycle.run(new Date());
      card = await t.prisma.card.findUniqueOrThrow({ where: { id: card.id } });
      expect(card).toMatchObject({ status: 'pooled', ownerId: null, balance: 0n });
      expect(
        await t.prisma.ledgerEntry.count({ where: { accountId: card.id, reason: 'card_burn' } }),
      ).toBe(1);
      expect(await findLedgerMismatches(t.prisma)).toEqual([]);
    });

    it('charges the penalty fee for cashing out an expired card', async () => {
      const session = await login(t);
      const { body } = await spin(session);
      await t.prisma.card.update({
        where: { id: body.card.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await post<{ payout: number }>(t, session, `/v1/cards/${body.card.id}/cashout`);
      expect(res.body.payout).toBe(Math.floor(body.card.balance * 0.8));
    });

    it('always has the free starter holder, even without its row (D-150)', async () => {
      const session = await login(t);
      await t.prisma.userHolder.deleteMany({ where: { userId: session.userId } });
      const res = await t.app.inject({ url: '/v1/cards', headers: session.auth });
      expect(res.json()).toMatchObject({
        slots: { used: 0, total: freeSlots },
        ownedHolders: ['basic'],
      });
      const { body } = await spin(session);
      expect((await hold(session, body.card.id)).status).toBe(200);
    });

    it('fills the holder, then buys a bigger one', async () => {
      const session = await login(t);
      const seasonId = (await t.prisma.season.findFirstOrThrow()).id;
      for (let i = 0; i < freeSlots; i++) {
        await t.prisma.card.create({
          data: {
            seasonId,
            ownerId: session.userId,
            bankId: 'lemon',
            region: 'RU',
            currency: 'RUB',
            tier: 'common',
            number: `9${(BigInt(Date.now()) * 10n + BigInt(i)).toString().padStart(15, '3').slice(-15)}`,
            numberPatterns: [],
            rarityScore: 1,
            baseLimit: 1n,
            initialBalance: 0n,
            luckBonusBp: 0,
            status: 'active',
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() + 86_400_000),
            heldAt: new Date(),
          },
        });
      }
      const { body } = await spin(session);
      expect((await hold(session, body.card.id)).body.error.code).toBe('HOLDER_FULL');

      const buy = (payWith: string) =>
        post<ErrorBody & { slotsTotal: number }>(t, session, '/v1/holders/buy', {
          holderId: 'leather',
          payWith,
        });
      expect((await buy('RUB')).body.error.code).toBe('HOLDER_LOCKED');
      expect((await buy('stars')).body.error.code).toBe('NOT_AVAILABLE');
      await t.prisma.user.update({ where: { id: session.userId }, data: { level: 10 } });
      expect((await buy('RUB')).body.error.code).toBe('INSUFFICIENT_FUNDS');
      await fund(t, session.userId, 'RUB', 2_000_000n);
      const bought = await buy('RUB');
      expect(bought.body.slotsTotal).toBe(freeSlots + leatherSlots);
      expect((await buy('RUB')).body.error.code).toBe('HOLDER_ALREADY_OWNED');
      expect((await hold(session, body.card.id)).status).toBe(200);
    });
  });

  describe('daily bonus', () => {
    it('credits day 1 once per day and replays a repeated key', async () => {
      const session = await login(t);
      const key = idempotencyKey();
      const first = await post<{ day: number; credited: unknown; exp: { gained: number } }>(
        t,
        session,
        '/v1/bonus/daily/claim',
        { idempotencyKey: key },
      );
      expect(first.body).toMatchObject({
        day: 1,
        credited: { currency: 'RUB', amount: 50_000 },
        exp: { gained: 20 },
      });
      expect(await wallet(session.userId)).toBe(550_000n);
      const replay = await post(t, session, '/v1/bonus/daily/claim', { idempotencyKey: key });
      expect(replay.body).toEqual(first.body);
      expect((await post<ErrorBody>(t, session, '/v1/bonus/daily/claim')).body.error.code).toBe(
        'DAILY_ALREADY_CLAIMED',
      );
    });

    it('guarantees Epic+ on the spin after the 7th day', async () => {
      const session = await login(t);
      const yesterday = new Date(Date.now() - 86_400_000);
      await t.prisma.dailyStreak.create({
        data: {
          userId: session.userId,
          streak: 6,
          lastClaimDate: new Date(
            Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate()),
          ),
        },
      });
      await t.prisma.user.update({ where: { id: session.userId }, data: { totalSpins: 10 } });
      const claim = await post<{ day: number }>(t, session, '/v1/bonus/daily/claim');
      expect(claim.body.day).toBe(7);
      const { body } = await spin(session);
      expect(['epic', 'legendary', 'mythic']).toContain(body.card.tier);
      expect(body.guaranteeApplied).toBe(true);
      expect(
        (await t.prisma.user.findUniqueOrThrow({ where: { id: session.userId } })).guaranteedFloor,
      ).toBeNull();
    });
  });
});
