import { TEST_STARTER_SLOTS } from './support/global-setup.js';
import type {
  ChestClaimResponse,
  SpinResponse,
  LeaderboardResponse,
  PlayerProfileResponse,
  ProfileStats,
  ReferralsResponse,
  ShopBuyResponse,
} from '@spincards/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GameConfigService } from '../src/game-config/game-config.service.js';
import { ReferralCommissionService } from '../src/game/referral.service.js';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import {
  createTestApp,
  fund,
  markPlayed,
  idempotencyKey,
  login,
  post,
  type Session,
  type TestApp,
} from './support/app.js';

type ErrorBody = { error: { code: string } };

describe('bonuses, shop, referrals and leaderboards', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  const get = async <T>(session: Session, url: string) =>
    (await t.app.inject({ url, headers: session.auth })).json<T>();
  const rub = async (userId: string) =>
    (
      await t.prisma.wallet.findUniqueOrThrow({
        where: { userId_currency: { userId, currency: 'RUB' } },
      })
    ).balance;

  describe('chest', () => {
    it('opens one chest per 30 spins, keeps at most 5 and replays a repeated key', async () => {
      const session = await login(t);
      expect((await post<ErrorBody>(t, session, '/v1/bonus/chest/claim')).body.error.code).toBe(
        'NO_CHEST_AVAILABLE',
      );

      await t.prisma.user.update({ where: { id: session.userId }, data: { totalSpins: 237 } });
      const me = await get<{ game: { chest: unknown } }>(session, '/v1/me');
      expect(me.game.chest).toEqual({ available: 5, progress: 27, everySpins: 30, level: 1 });

      const key = idempotencyKey();
      const before = await rub(session.userId);
      const first = await post<ChestClaimResponse>(t, session, '/v1/bonus/chest/claim', {
        idempotencyKey: key,
      });
      expect(first.status).toBe(200);
      expect(first.body.chest.available).toBe(4);
      const replay = await post<ChestClaimResponse>(t, session, '/v1/bonus/chest/claim', {
        idempotencyKey: key,
      });
      expect(replay.body).toEqual(first.body);

      const credited = first.body.credited?.amount ?? 0;
      expect(await rub(session.userId)).toBe(before + BigInt(credited));
      if (first.body.reward.luck) {
        expect(
          await t.prisma.userBuff.count({ where: { userId: session.userId, source: 'chest' } }),
        ).toBe(1);
      }
      for (let i = 0; i < 4; i++) await post(t, session, '/v1/bonus/chest/claim');
      expect((await post<ErrorBody>(t, session, '/v1/bonus/chest/claim')).body.error.code).toBe(
        'NO_CHEST_AVAILABLE',
      );
    });
  });

  describe('shop', () => {
    it('sells free spins; luck is not sold for game money any more (D-147)', async () => {
      const session = await login(t);
      const buy = (itemId: string, extra: Record<string, unknown> = {}) =>
        post<ShopBuyResponse & ErrorBody>(t, session, '/v1/shop/buy', {
          itemId,
          currency: 'RUB',
          ...extra,
        });
      const spins = await buy('free_spins_3');
      expect(spins.body.freeSpins.available).toBe(6);
      expect((await buy('buff_small', { packId: 'basic' })).status).toBe(404);
      expect((await buy('nope')).status).toBe(404);
      expect(await findLedgerMismatches(t.prisma)).toEqual([]);
    });

    it('adds bonus luck points to the next spins of any pack (D-147)', async () => {
      const session = await login(t);
      await t.prisma.user.update({ where: { id: session.userId }, data: { totalSpins: 10 } });
      await t.prisma.userBuff.create({
        data: { userId: session.userId, luckPoints: 10, spinsLeft: 2, source: 'wheel' },
      });
      const free = await post<SpinResponse>(t, session, '/v1/spin', {
        packId: 'free',
        payment: { type: 'wallet' },
      });
      const freeRow = await t.prisma.spin.findUniqueOrThrow({
        where: { id: free.body.spins[0]!.spinId },
      });
      expect((freeRow.rolledParams as { luckPoints: number }).luckPoints).toBe(10);
      await post(t, session, `/v1/cards/${free.body.spins[0]!.card.id}/cashout`);
      const paid = await post<SpinResponse>(t, session, '/v1/spin', {
        packId: 'basic',
        payment: { type: 'wallet' },
      });
      const paidRow = await t.prisma.spin.findUniqueOrThrow({
        where: { id: paid.body.spins[0]!.spinId },
      });
      expect((paidRow.rolledParams as { luckPoints: number }).luckPoints).toBe(10);
      // Two spins used it up.
      expect(
        await t.prisma.userBuff.findFirstOrThrow({ where: { userId: session.userId } }),
      ).toMatchObject({ spinsLeft: 0 });
    });
  });

  describe('referrals', () => {
    it('welcomes the friend once qualified and pays the referrer a share of their spins', async () => {
      const referrer = await login(t);
      const { referralCode } = await t.prisma.user.findUniqueOrThrow({
        where: { id: referrer.userId },
      });
      const invited = await login(t, { startParam: `ref_${referralCode}` });
      await fund(t, invited.userId, 'RUB', 10_000_000n);

      // Four spins: not yet.
      await t.prisma.user.update({
        where: { id: invited.userId },
        data: { totalSpins: 3, exp: 125 },
      });
      const spin = async () => {
        const res = await post<SpinResponse>(t, invited, '/v1/spin', {
          packId: 'basic',
          payment: { type: 'wallet' },
        });
        await post(t, invited, `/v1/cards/${res.body.spins[0]!.card.id}/cashout`);
      };
      await spin();
      let list = await get<ReferralsResponse>(referrer, '/v1/referrals');
      expect(list.invited).toEqual([expect.objectContaining({ status: 'pending', spins: 4 })]);
      const referrerBefore = await rub(referrer.userId);

      await spin(); // 5th spin, level 2 by EXP
      list = await get<ReferralsResponse>(referrer, '/v1/referrals');
      expect(list).toMatchObject({ code: referralCode, spinsRequired: 5, levelRequired: 2 });
      expect(list.invited[0]).toMatchObject({ status: 'rewarded', spins: 5, level: 2 });
      // D-158: 30 000 ₽ to the referrer, 10 000 ₽ to the friend.
      expect(await rub(referrer.userId)).toBe(referrerBefore + 3_000_000n);
      expect(
        await t.prisma.ledgerEntry.findMany({
          where: { reason: 'referral', userId: invited.userId },
          select: { delta: true },
        }),
      ).toEqual([{ delta: 1_000_000n }]);
      // The referrer hears about it from the bot (outbox row in the same transaction).
      expect(
        await t.prisma.notificationOutbox.findMany({
          where: { userId: referrer.userId, kind: 'referral_reward' },
        }),
      ).toEqual([
        expect.objectContaining({
          kind: 'referral_reward',
          payload: { share: 10, days: 30 },
          status: 'pending',
        }),
      ]);

      await spin(); // no second reward
      expect(
        await t.prisma.ledgerEntry.count({ where: { reason: 'referral', userId: invited.userId } }),
      ).toBe(1);

      // Commission: 10% of the friend's three paid basic spins (3 × 1 000 ₽), paid once.
      const commission = t.app.get(ReferralCommissionService);
      await commission.run();
      await commission.run();
      expect(await rub(referrer.userId)).toBe(referrerBefore + 3_030_000n);
      list = await get<ReferralsResponse>(referrer, '/v1/referrals');
      // D-177: what the friend brought counts the reward (30 000 ₽) and the commission (300 ₽).
      expect(list.invited[0]?.earned).toEqual([{ currency: 'RUB', amount: 3_030_000 }]);

      // D-119: the commission from one friend stops at capPerReferral (here 400 ₽ in total).
      const configs = t.app.get(GameConfigService);
      const active = configs.active.bind(configs);
      configs.active = async () => {
        const current = await active();
        const referral = current.config.referral;
        return {
          ...current,
          config: {
            ...current.config,
            referral: {
              ...referral,
              commission: { ...referral.commission, capPerReferral: { RUB: 40_000, USD: 1 } },
            },
          },
        };
      };
      try {
        await spin();
        await spin();
        await commission.run();
      } finally {
        configs.active = active;
      }
      expect(await rub(referrer.userId)).toBe(referrerBefore + 3_040_000n);
      expect(await findLedgerMismatches(t.prisma)).toEqual([]);
    });

    it('rewards any number of friends a day with dailyLimit 0, holds the rest with a limit', async () => {
      const qualify = async (limit: number) => {
        const referrer = await login(t);
        const { referralCode } = await t.prisma.user.findUniqueOrThrow({
          where: { id: referrer.userId },
        });
        const configs = t.app.get(GameConfigService);
        const active = configs.active.bind(configs);
        configs.active = async () => {
          const current = await active();
          return {
            ...current,
            config: {
              ...current.config,
              referral: { ...current.config.referral, dailyLimit: limit },
            },
          };
        };
        try {
          for (let i = 0; i < 3; i++) {
            const friend = await login(t, { startParam: `ref_${referralCode}` });
            await fund(t, friend.userId, 'RUB', 10_000_000n);
            await t.prisma.user.update({
              where: { id: friend.userId },
              data: { totalSpins: 4, exp: 125 },
            });
            const res = await post<SpinResponse>(t, friend, '/v1/spin', {
              packId: 'basic',
              payment: { type: 'wallet' },
            });
            await post(t, friend, `/v1/cards/${res.body.spins[0]!.card.id}/cashout`);
          }
        } finally {
          configs.active = active;
        }
        return t.prisma.referral.count({
          where: { referrerId: referrer.userId, status: 'rewarded' },
        });
      };
      expect(await qualify(0)).toBe(3);
      expect(await qualify(2)).toBe(2);
    });
  });

  describe('leaderboard, settings and stats', () => {
    it('shows a ranked player profile with their rarest cards, hiding opted-out players', async () => {
      const owner = await login(t, { firstName: 'Коллекционер' });
      const viewer = await login(t);
      const res = await post<SpinResponse>(t, owner, '/v1/spin', {
        packId: 'basic',
        payment: { type: 'wallet' },
      });
      const card = res.body.spins[0]!.card;
      await post(t, owner, `/v1/cards/${card.id}/hold`);
      const profile = await get<PlayerProfileResponse>(viewer, `/v1/players/${owner.userId}`);
      expect(profile).toMatchObject({
        firstName: 'Коллекционер',
        totalSpins: 1,
        seasonSpins: 1,
        collection: { score: card.rarityScore, cards: 1 },
      });
      expect(profile.topCards.map((c) => c.id)).toEqual([card.id]);

      await t.app.inject({
        method: 'POST',
        url: '/v1/settings',
        headers: owner.auth,
        payload: { hideFromLeaderboard: true },
      });
      const hidden = await t.app.inject({
        url: `/v1/players/${owner.userId}`,
        headers: viewer.auth,
      });
      expect(hidden.statusCode).toBe(404);
      const self = await t.app.inject({ url: `/v1/players/${owner.userId}`, headers: owner.auth });
      expect(self.statusCode).toBe(200);
    });

    it('ranks by balance, hides players who opted out and shows my place', async () => {
      const rich = await login(t, { firstName: 'Богач' });
      await fund(t, rich.userId, 'RUB', 999_000_000_000n);
      await markPlayed(t, rich.userId);
      const board = await get<LeaderboardResponse>(rich, '/v1/leaderboard?type=balance');
      expect(board.top[0]).toMatchObject({ rank: 1, firstName: 'Богач', isMe: true });
      expect(board.me).toMatchObject({ rank: 1 });

      const res = await t.app.inject({
        method: 'POST',
        url: '/v1/settings',
        headers: rich.auth,
        payload: { hideFromLeaderboard: true },
      });
      expect(res.statusCode).toBe(204);
      const hidden = await get<LeaderboardResponse>(rich, '/v1/leaderboard?type=balance');
      expect(hidden.me).toBeNull();
      expect(hidden.top.some((e) => e.firstName === 'Богач')).toBe(false);

      const bad = await t.app.inject({
        method: 'POST',
        url: '/v1/settings',
        headers: rich.auth,
        payload: { level: 99 },
      });
      expect(bad.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    });

    it('ranks collections by rarity of live cards', async () => {
      const session = await login(t);
      const res = await post<SpinResponse>(t, session, '/v1/spin', {
        packId: 'basic',
        payment: { type: 'wallet' },
      });
      await post(t, session, `/v1/cards/${res.body.spins[0]!.card.id}/hold`);
      const board = await get<LeaderboardResponse>(session, '/v1/leaderboard?type=collection');
      expect(board.me).toMatchObject({ score: res.body.spins[0]!.card.rarityScore, isMe: true });
    });

    it('returns profile stats', async () => {
      const session = await login(t);
      const res = await post<SpinResponse>(t, session, '/v1/spin', {
        packId: 'basic',
        payment: { type: 'wallet' },
      });
      await post(t, session, `/v1/cards/${res.body.spins[0]!.card.id}/hold`);
      expect(await get<ProfileStats>(session, '/v1/me/stats')).toMatchObject({
        totalSpins: 1,
        season: { name: 'Бета', spins: 1, cardsIssued: 1 },
        holder: {
          cards: 1,
          slots: TEST_STARTER_SLOTS,
        },
      });
    });
  });
});
