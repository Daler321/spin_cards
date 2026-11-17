import type { ShareImageResponse, SharePrepareResponse, SpinResponse } from '@spincards/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ShareService } from '../src/share/share.service.js';
import { createTestApp, login, post, type TestApp } from './support/app.js';

type ErrorBody = { error: { code: string } };
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);

describe('card sharing', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    // This app instance only: the settings table is shared with other test files.
    t.app.get(ShareService).settings = () =>
      Promise.resolve({ adText: 'Новости <канала>', adUrl: 'https://t.me/spincards_news' });
  });
  afterAll(() => t.close());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores a rendered card, serves it publicly and prepares a photo message', async () => {
    const owner = await login(t);
    const stranger = await login(t);
    const spin = await post<SpinResponse>(t, owner, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    const cardId = spin.body.spins[0]!.card.id;
    const upload = (session = owner, image = jpeg.toString('base64')) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/share/images',
        headers: session.auth,
        payload: { cardId, image },
      });

    expect((await upload(stranger)).json<ErrorBody>().error.code).toBe('CARD_NOT_FOUND');
    expect((await upload(owner, Buffer.alloc(300, 1).toString('base64'))).statusCode).toBe(400);
    const stored = (await upload()).json<ShareImageResponse>();
    expect(stored.url).toMatch(/\/api\/v1\/share\/images\/[\w-]{32}\.jpg$/);

    const file = await t.app.inject({ url: `/v1/share/images/${stored.token}.jpg` });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(file.rawPayload.equals(jpeg)).toBe(true);

    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string) as Record<string, unknown>);
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: { id: 'prep-1' } }), { status: 200 }),
      );
    });
    const prepare = (session = owner) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/share/prepare',
        headers: session.auth,
        payload: {
          token: stored.token,
          text: 'Мне выпала карта!',
          link: 'https://t.me/spincards_bot?startapp=ref_ABCD2345',
          linkText: 'Испытай удачу',
        },
      });
    expect((await prepare(stranger)).statusCode).toBe(404);
    expect((await prepare()).json<SharePrepareResponse>()).toEqual({ preparedMessageId: 'prep-1' });
    expect(sent[0]).toMatchObject({
      result: {
        type: 'photo',
        photo_url: stored.url,
        caption:
          'Мне выпала карта!\n<a href="https://t.me/spincards_bot?startapp=ref_ABCD2345">Испытай удачу</a>' +
          '\n\n<a href="https://t.me/spincards_news">Новости &lt;канала&gt;</a>',
        parse_mode: 'HTML',
      },
      allow_user_chats: true,
    });
  });
});
