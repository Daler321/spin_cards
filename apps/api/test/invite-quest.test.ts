import {
  type ChannelQuestClaimResponse,
  DEFAULT_GAME_CONFIG,
  type QuestsResponse,
} from '@spincards/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SeasonService } from '../src/game-config/season.service.js';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import { createTestApp, get, idempotencyKey, login, post, type TestApp } from './support/app.js';

type ErrorBody = { error: { code: string } };

describe('invite quest (D-158)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const steps = DEFAULT_GAME_CONFIG.quests.invite?.steps ?? [];

  /** Friends who qualified (rewarded referrals), `at` the given moment. */
  async function invite(referrerId: string, count: number, at = new Date()) {
    for (let i = 0; i < count; i++) {
      const friend = await login(t);
      await t.prisma.referral.create({
        data: { referrerId, referredId: friend.userId, status: 'rewarded', rewardedAt: at },
      });
    }
  }

  it('pays each step once a season, counting friends who qualified this season', async () => {
    const first = steps[0]!;
    const session = await login(t);
    const claim = (friends: number) =>
      post<ChannelQuestClaimResponse & ErrorBody>(t, session, '/v1/quests/invite/claim', {
        friends,
        idempotencyKey: idempotencyKey(),
      });

    let list = await get<QuestsResponse>(t, session, '/v1/quests');
    expect(list.invite).toMatchObject({
      friends: 0,
      rule: {
        spins: DEFAULT_GAME_CONFIG.referral.spinsRequired,
        level: DEFAULT_GAME_CONFIG.referral.levelRequired,
      },
    });
    expect(list.invite?.steps.map((s) => s.friends)).toEqual(steps.map((s) => s.friends));
    expect((await claim(first.friends)).body.error.code).toBe('QUEST_NOT_COMPLETED');

    // Friends from before the season do not count; pending ones do not either.
    const season = await t.app.get(SeasonService).current();
    await invite(session.userId, 3, new Date(season.startsAt.getTime() - 60_000));
    const pending = await login(t);
    await t.prisma.referral.create({
      data: { referrerId: session.userId, referredId: pending.userId },
    });
    await invite(session.userId, first.friends);
    list = await get<QuestsResponse>(t, session, '/v1/quests');
    expect(list.invite?.friends).toBe(first.friends);

    const paid = await claim(first.friends);
    expect(paid.status).toBe(200);
    expect(paid.body.credited).toEqual({ currency: 'RUB', amount: first.reward.money?.RUB });
    expect((await claim(first.friends)).body.error.code).toBe('QUEST_ALREADY_CLAIMED');
    expect((await claim(steps[1]!.friends)).body.error.code).toBe('QUEST_NOT_COMPLETED');
    expect((await claim(first.friends + 1)).body.error.code).toBe('NOT_FOUND');

    list = await get<QuestsResponse>(t, session, '/v1/quests');
    expect(list.invite?.steps[0]).toMatchObject({ friends: first.friends, claimed: true });
    expect(list.season.some((q) => q.questId.startsWith('invite_'))).toBe(false);
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('is hidden once every step is taken', async () => {
    const session = await login(t);
    await invite(session.userId, steps.at(-1)!.friends);
    for (const step of steps) {
      const res = await post(t, session, '/v1/quests/invite/claim', {
        friends: step.friends,
        idempotencyKey: idempotencyKey(),
      });
      expect(res.status).toBe(200);
    }
    expect((await get<QuestsResponse>(t, session, '/v1/quests')).invite).toBeNull();
  });
});
