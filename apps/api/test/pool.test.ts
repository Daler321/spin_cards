import type { SpinResponse } from '@spincards/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RefreshingCache } from '../src/common/refreshing-cache.js';
import { FlagsService } from '../src/game-config/flags.service.js';
import { GameConfigService } from '../src/game-config/game-config.service.js';
import { createTestApp, login, post, type TestApp } from './support/app.js';

describe('RefreshingCache', () => {
  it('serves the stale value while one query refreshes it', async () => {
    let loads = 0;
    let release: (value: number) => void = () => undefined;
    const cache = new RefreshingCache(0, () => {
      loads++;
      return loads === 1 ? Promise.resolve(1) : new Promise<number>((r) => (release = r));
    });
    expect(await cache.get()).toBe(1);
    // Expired (ttl 0): both reads get the old value at once, one refresh runs.
    expect(await Promise.all([cache.get(), cache.get()])).toEqual([1, 1]);
    expect(loads).toBe(2);
    release(2);
    await new Promise((r) => setTimeout(r, 0));
    expect(await cache.get()).toBe(2);
  });
});

/**
 * D-118 regression: with a single pool connection, a transaction that needs a second connection
 * (a cache refresh through the shared pool inside it) would wait for maxWait and fail.
 */
describe('one pool connection', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ DATABASE_POOL_SIZE: '1' });
  });
  afterAll(() => t.close());

  it('reads stale caches inside a transaction without a second connection', async () => {
    const session = await login(t);
    await new Promise((r) => setTimeout(r, 5200)); // config and flag caches live 5 s
    const started = Date.now();
    // What the spin does under load: the cache expires between the pre-check and the transaction.
    await t.prisma.transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1`;
      await t.app.get(FlagsService).isPackPaused('basic');
      await t.app.get(GameConfigService).active();
    });
    expect(Date.now() - started).toBeLessThan(2000);

    const spin = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    expect(spin.status).toBe(200);
    const cardId = spin.body.spins[0]!.card.id;
    expect((await post(t, session, `/v1/cards/${cardId}/cashout`, {})).status).toBe(200);
  }, 40_000);
});
