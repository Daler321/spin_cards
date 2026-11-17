import type { SubscriptionStatus } from '@spincards/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SubscriptionService } from '../src/subscription/subscription.service.js';
import { createTestApp, login, nextTelegramId, post, type TestApp } from './support/app.js';
import { TEST_INTERNAL_TOKEN } from './support/env.js';

type ErrorBody = { error: { code: string } };

describe('required channel subscription', () => {
  let t: TestApp;
  let status = 'left';
  const calls: string[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    // This app instance only: other test files share the settings table.
    t.app.get(SubscriptionService).settings = () =>
      Promise.resolve({
        enabled: true,
        channels: [
          { chatId: '@spincards_news', title: 'Новости', url: 'https://t.me/spincards_news' },
        ],
      });
  });
  afterAll(() => t.close());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const telegram = () =>
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(url);
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: { status } }), { status: 200 }),
      );
    });

  it('blocks game routes until the player joins, then lets them in', async () => {
    telegram();
    const telegramId = nextTelegramId();
    const session = await login(t, { telegramId });
    const spin = await post<ErrorBody>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    expect(spin.status).toBe(403);
    expect(spin.body.error.code).toBe('SUBSCRIPTION_REQUIRED');
    // Profile and the status itself still work.
    expect((await t.app.inject({ url: '/v1/me', headers: session.auth })).statusCode).toBe(200);
    const before = await t.app.inject({ url: '/v1/subscription', headers: session.auth });
    expect(before.json<SubscriptionStatus>()).toEqual({
      required: true,
      ok: false,
      channels: [{ title: 'Новости', url: 'https://t.me/spincards_news', joined: false }],
    });
    expect(calls.at(-1)).toContain('/getChatMember');

    status = 'member';
    const checked = await t.app.inject({
      method: 'POST',
      url: '/v1/subscription/check',
      headers: session.auth,
    });
    expect(checked.json<SubscriptionStatus>().ok).toBe(true);
    const after = await post(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    expect(after.status).toBe(200);
  });

  it('answers the bot and lets players in when Telegram cannot check', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), {
          status: 400,
        }),
      ),
    );
    const res = await t.app.inject({
      method: 'POST',
      url: '/internal/bot/subscription',
      headers: { 'x-internal-token': TEST_INTERNAL_TOKEN },
      payload: { telegramId: String(nextTelegramId()), fresh: true },
    });
    expect(res.json<SubscriptionStatus>()).toMatchObject({ required: true, ok: true });
  });

  it('does not let in a player Telegram does not know in the channel (D-153)', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ ok: false, description: 'Bad Request: PARTICIPANT_ID_INVALID' }),
          { status: 400 },
        ),
      ),
    );
    const session = await login(t, { telegramId: nextTelegramId() });
    const spin = await post<ErrorBody>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    expect(spin.body.error.code).toBe('SUBSCRIPTION_REQUIRED');
    const status = await t.app.inject({ url: '/v1/subscription', headers: session.auth });
    expect(status.json<SubscriptionStatus>()).toMatchObject({ required: true, ok: false });
  });
});
