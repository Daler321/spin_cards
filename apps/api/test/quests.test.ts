import {
  DEFAULT_GAME_CONFIG,
  type QuestClaimResponse,
  type QuestsResponse,
  type SpinResponse,
} from '@spincards/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import { createTestApp, get, idempotencyKey, login, post, type TestApp } from './support/app.js';

type ErrorBody = { error: { code: string } };

describe('quests (D-124)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('draws daily and season quests, counts spins and pays a completed quest once', async () => {
    const session = await login(t);
    const first = await get<QuestsResponse>(t, session, '/v1/quests');
    expect(first.daily).toHaveLength(DEFAULT_GAME_CONFIG.quests.dailyCount);
    expect(new Set(first.daily.map((q) => q.questId)).size).toBe(
      DEFAULT_GAME_CONFIG.quests.dailyCount,
    );
    expect(first.season.length).toBeGreaterThan(5);
    expect(new Date(first.dailyResetsAt).getTime()).toBeGreaterThan(Date.now());
    // The same day keeps the same quests.
    expect((await get<QuestsResponse>(t, session, '/v1/quests')).daily.map((q) => q.id)).toEqual(
      first.daily.map((q) => q.id),
    );

    // Make one daily quest about spins with a target of 2, so the test does not depend on the draw.
    const daily = first.daily[0]!;
    await t.prisma.questProgress.update({
      where: { id: daily.id },
      data: { metric: 'spins', target: 2, tier: null, reward: { money: { RUB: 100_000 }, exp: 5 } },
    });
    const spinOnce = async () => {
      const res = await post<SpinResponse>(t, session, '/v1/spin', {
        packId: 'basic',
        payment: { type: 'wallet' },
      });
      await post(t, session, `/v1/cards/${res.body.spins[0]!.card.id}/cashout`);
    };
    await spinOnce();
    const claimEarly = await post<ErrorBody>(t, session, `/v1/quests/${daily.id}/claim`, {
      idempotencyKey: idempotencyKey(),
    });
    expect(claimEarly.body.error.code).toBe('QUEST_NOT_COMPLETED');
    await spinOnce();

    const after = await get<QuestsResponse>(t, session, '/v1/quests');
    const done = after.daily.find((q) => q.id === daily.id)!;
    expect(done).toMatchObject({ progress: 2, completed: true, claimed: false });
    // Season quests count the same spins.
    expect(after.season.find((q) => q.questId === 'season_spins_1000')?.progress).toBe(2);
    expect(after.season.find((q) => q.questId === 'season_cashouts_500')?.progress).toBe(2);

    const key = idempotencyKey();
    const claim = await post<QuestClaimResponse>(t, session, `/v1/quests/${daily.id}/claim`, {
      idempotencyKey: key,
    });
    expect(claim.status).toBe(200);
    // Daily money grows with the level (level 1: as configured).
    expect(claim.body.credited).toEqual({ currency: 'RUB', amount: 100_000 });
    expect(claim.body.exp.gained).toBe(5);
    expect(claim.body.quest.claimed).toBe(true);
    const replay = await post<QuestClaimResponse>(t, session, `/v1/quests/${daily.id}/claim`, {
      idempotencyKey: key,
    });
    expect(replay.body).toEqual(claim.body);
    const again = await post<ErrorBody>(t, session, `/v1/quests/${daily.id}/claim`, {
      idempotencyKey: idempotencyKey(),
    });
    expect(again.body.error.code).toBe('QUEST_ALREADY_CLAIMED');
    expect(
      await t.prisma.ledgerEntry.count({ where: { userId: session.userId, reason: 'quest' } }),
    ).toBe(1);

    // Someone else's quest is not found.
    const stranger = await login(t);
    const foreign = await post<ErrorBody>(t, stranger, `/v1/quests/${daily.id}/claim`, {
      idempotencyKey: idempotencyKey(),
    });
    expect(foreign.status).toBe(404);
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('measures the holder and counts the day of the visit', async () => {
    const session = await login(t);
    const res = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    const cardId = res.body.spins[0]!.card.id;
    await post(t, session, `/v1/cards/${cardId}/hold`);
    // Pretend the card has been held for four days.
    await t.prisma.card.update({
      where: { id: cardId },
      data: { heldAt: new Date(Date.now() - 97 * 3600_000) },
    });
    await get(t, session, '/v1/me');
    const quests = await get<QuestsResponse>(t, session, '/v1/quests');
    const season = (id: string) => quests.season.find((q) => q.questId === id);
    expect(season('season_holder_5')?.progress).toBe(1);
    expect(season('season_hold_96h')).toMatchObject({ progress: 96, completed: true });
    expect(season('season_visits_7')?.progress).toBe(1);
  });
});
