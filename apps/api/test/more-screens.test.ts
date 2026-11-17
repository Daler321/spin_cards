import { randomUUID } from 'node:crypto';
import type {
  PlayerProfileResponse,
  PublicConfigResponse,
  ReferralsResponse,
  SeasonsResponse,
} from '@spincards/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SeasonService } from '../src/game-config/season.service.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { createTestApp, get, login, type TestApp } from './support/app.js';

type ErrorBody = { error: { code: string } };

describe('«Ещё» screens: seasons, player by @username, referral earnings, news (D-177)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  it('describes the current season', async () => {
    const session = await login(t);
    const info = await get<SeasonsResponse>(t, session, '/v1/seasons');
    const season = await t.app.get(SeasonService).current();
    expect(info.current).toMatchObject({
      name: season.name,
      startsAt: season.startsAt.toISOString(),
    });
    expect(info.current.finished).toBe(info.past.length);
  });

  it('finds a player by @username, case-insensitively, and hides hidden ones', async () => {
    const viewer = await login(t);
    const target = await login(t, { firstName: 'Коллекционер' });
    const username = `Coll_${randomUUID().slice(0, 8)}`;
    await t.prisma.user.update({ where: { id: target.userId }, data: { username } });

    const found = await get<PlayerProfileResponse>(
      t,
      viewer,
      `/v1/players/by-username/@${username.toLowerCase()}`,
    );
    expect(found).toMatchObject({ userId: target.userId, firstName: 'Коллекционер' });

    await t.prisma.user.update({
      where: { id: target.userId },
      data: { hideFromLeaderboard: true },
    });
    const hidden = await get<ErrorBody>(t, viewer, `/v1/players/by-username/${username}`);
    expect(hidden.error.code).toBe('PLAYER_NOT_FOUND');
    const missing = await get<ErrorBody>(t, viewer, '/v1/players/by-username/nobody_here_42');
    expect(missing.error.code).toBe('PLAYER_NOT_FOUND');
  });

  it('counts the friend reward in what a referral earned', async () => {
    const referrer = await login(t);
    const friend = await login(t);
    const referral = await t.prisma.referral.create({
      data: { referrerId: referrer.userId, referredId: friend.userId },
    });
    const wallet = await t.prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: referrer.userId, currency: 'RUB' } },
    });
    const seasonId = await t.app.get(SeasonService).currentSeasonId();
    await t.prisma.transaction((tx) =>
      t.app.get(LedgerService).post(
        tx,
        [
          {
            account: { type: 'wallet', id: wallet.id },
            delta: 30_000n,
            reason: 'referral',
            ref: { type: 'referral', id: referral.id },
          },
        ],
        { seasonId },
      ),
    );
    const list = await get<ReferralsResponse>(t, referrer, '/v1/referrals');
    expect(list.invited[0]?.earned).toEqual([{ currency: 'RUB', amount: 30_000 }]);
  });

  it('publishes the news channel', async () => {
    const config = (await t.app.inject({ url: '/v1/config/public' })).json<PublicConfigResponse>();
    expect(config.newsUrl).toMatch(/^https:\/\/t\.me\//);
  });
});
