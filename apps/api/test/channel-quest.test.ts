import {
  type ChannelQuestClaimResponse,
  DEFAULT_GAME_CONFIG,
  type QuestsResponse,
} from '@spincards/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import { SubscriptionService } from '../src/subscription/subscription.service.js';
import { createTestApp, get, idempotencyKey, login, post, type TestApp } from './support/app.js';

type ErrorBody = { error: { code: string } };

const CHANNEL = { chatId: '@spincards_news', title: 'Новости', url: 'https://t.me/spincards_news' };

describe('channel quest (D-157)', () => {
  let t: TestApp;
  let channels = [CHANNEL];
  let status = 'left';

  beforeAll(async () => {
    t = await createTestApp();
    // This app instance only: other test files share the settings table. The gate stays off.
    t.app.get(SubscriptionService).settings = () => Promise.resolve({ enabled: false, channels });
  });
  afterAll(() => t.close());
  afterEach(() => {
    vi.unstubAllGlobals();
    channels = [CHANNEL];
  });

  const telegram = () =>
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: { status } }), { status: 200 }),
      ),
    );
  const reward = DEFAULT_GAME_CONFIG.quests.channel?.reward.money?.RUB;

  it('is not offered without channels', async () => {
    channels = [];
    const session = await login(t);
    expect((await get<QuestsResponse>(t, session, '/v1/quests')).channel).toBeNull();
    const claim = await post<ErrorBody>(t, session, '/v1/quests/channel/claim', {
      idempotencyKey: idempotencyKey(),
    });
    expect(claim.body.error.code).toBe('NOT_FOUND');
  });

  it('pays a member once a season and then hides the quest', async () => {
    telegram();
    status = 'left';
    const session = await login(t);
    const list = await get<QuestsResponse>(t, session, '/v1/quests');
    expect(list.channel).toEqual({
      channels: [{ title: CHANNEL.title, url: CHANNEL.url }],
      reward: {
        money: { currency: 'RUB', amount: reward },
        luck: null,
        freeSpins: null,
        exp: null,
      },
    });
    expect(list.season.some((q) => q.questId === 'channel_sub')).toBe(false);

    const early = await post<ErrorBody>(t, session, '/v1/quests/channel/claim', {
      idempotencyKey: idempotencyKey(),
    });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('CHANNEL_NOT_JOINED');

    status = 'member';
    const key = idempotencyKey();
    const claim = await post<ChannelQuestClaimResponse>(t, session, '/v1/quests/channel/claim', {
      idempotencyKey: key,
    });
    expect(claim.status).toBe(200);
    expect(claim.body.credited).toEqual({ currency: 'RUB', amount: reward });
    const replay = await post<ChannelQuestClaimResponse>(t, session, '/v1/quests/channel/claim', {
      idempotencyKey: key,
    });
    expect(replay.body).toEqual(claim.body);
    const again = await post<ErrorBody>(t, session, '/v1/quests/channel/claim', {
      idempotencyKey: idempotencyKey(),
    });
    expect(again.body.error.code).toBe('QUEST_ALREADY_CLAIMED');

    const after = await get<QuestsResponse>(t, session, '/v1/quests');
    expect(after.channel).toBeNull();
    const paid = await t.prisma.ledgerEntry.count({
      where: { reason: 'quest', refType: 'quest', userId: session.userId },
    });
    expect(paid).toBe(1);
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('does not pay when Telegram cannot check', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), {
          status: 400,
        }),
      ),
    );
    const session = await login(t);
    const claim = await post<ErrorBody>(t, session, '/v1/quests/channel/claim', {
      idempotencyKey: idempotencyKey(),
    });
    expect(claim.body.error.code).toBe('CHANNEL_NOT_JOINED');
  });
});
