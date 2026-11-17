import {
  type AchievementsResponse,
  DEFAULT_GAME_CONFIG,
  type LeaderboardResponse,
  type SpinResponse,
} from '@spincards/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import {
  createTestApp,
  get,
  login,
  markPlayed,
  patchConfig,
  post,
  type TestApp,
} from './support/app.js';

describe('achievements (D-133)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await patchConfig(t, (config) => {
      config.achievements = DEFAULT_GAME_CONFIG.achievements;
    });
  });
  afterAll(() => t.close());

  it('grants a medal once with its reward and lists it', async () => {
    const session = await login(t);
    // Make the player a spin away from 1 000 spins.
    await t.prisma.user.update({ where: { id: session.userId }, data: { totalSpins: 999 } });
    const before = await t.prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: session.userId, currency: 'RUB' } },
    });
    const spin = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    expect(spin.body.achievements).toContain('spins_1000');
    const rewarded = await t.prisma.ledgerEntry.findMany({
      where: { userId: session.userId, reason: 'achievement' },
    });
    expect(rewarded.map((e) => e.refId)).toContain(`spins_1000:${session.userId}`);
    expect(before.balance).toBeGreaterThan(0n);

    const card = spin.body.spins[0]!.card;
    await post(t, session, `/v1/cards/${card.id}/cashout`);
    const again = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    expect(again.body.achievements).not.toContain('spins_1000');

    const list = await get<AchievementsResponse>(t, session, '/v1/achievements');
    const medal = list.achievements.find((a) => a.id === 'spins_1000');
    expect(medal?.earned).toHaveLength(1);
    expect(list.achievements.find((a) => a.id === 'full_duplicate')?.earned).toEqual([]);
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('shows the rarest medals in the rating, or the ones the player picks (D-137)', async () => {
    const session = await login(t);
    const defs = DEFAULT_GAME_CONFIG.achievements.filter((a) => a.kind === 'permanent');
    const earned = defs.slice(0, 4).map((a) => a.id);
    await t.prisma.userAchievement.createMany({
      data: earned.map((achievementId) => ({ userId: session.userId, achievementId })),
    });
    const auto = await get<AchievementsResponse>(t, session, '/v1/achievements');
    expect(auto.chosen).toBe(false);
    expect(auto.shown).toHaveLength(3);
    for (const id of auto.shown) expect(earned).toContain(id);

    // Unearned ids are kept out of the rating; more than three is a validation error.
    const unearned = defs.find((a) => !earned.includes(a.id))!.id;
    const pick = async (pinnedMedals: string[]) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/settings',
        headers: session.auth,
        payload: { pinnedMedals },
      });
    expect((await pick([earned[3]!, unearned])).statusCode).toBe(204);
    const mine = await get<AchievementsResponse>(t, session, '/v1/achievements');
    expect(mine).toMatchObject({ chosen: true, shown: [earned[3]] });
    expect((await pick(earned)).json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    await markPlayed(t, session.userId);
    const board = await get<LeaderboardResponse>(t, session, '/v1/leaderboard?type=balance');
    expect(board.me?.medals).toEqual([defs[3]!.icon]);

    expect((await pick([])).statusCode).toBe(204);
    expect((await get<AchievementsResponse>(t, session, '/v1/achievements')).chosen).toBe(false);
  });

  it('does not bring medals back from an earlier season (D-151)', async () => {
    const session = await login(t);
    const spin = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    const card = spin.body.spins[0]!.card;
    // The same card dropped in a finished season: it must not count now.
    const old = await t.prisma.season.create({
      data: {
        name: `old-${String(Date.now())}`,
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt: new Date('2026-01-08T00:00:00Z'),
        status: 'finished',
      },
    });
    await t.prisma.card.update({ where: { id: card.id }, data: { tier: 'mythic' } });
    await t.prisma.spin.updateMany({ where: { cardId: card.id }, data: { seasonId: old.id } });
    await t.prisma.userAchievement.deleteMany({ where: { userId: session.userId } });
    const list = await get<AchievementsResponse>(t, session, '/v1/achievements');
    expect(list.achievements.find((a) => a.id === 'first_mythic')?.earned).toEqual([]);
  });
});
