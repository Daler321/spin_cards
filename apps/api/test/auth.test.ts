import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, login, nextTelegramId, signInitData, type TestApp } from './support/app.js';

describe('auth', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  const loginRaw = (initData: string) =>
    t.app.inject({ method: 'POST', url: '/v1/auth/telegram', payload: { initData } });

  it('creates a player with wallets, the starting bonus and the starter holder', async () => {
    const session = await login(t);
    const user = await t.prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
      include: { wallets: true, holders: true },
    });
    expect(user.wallets.map((w) => [w.currency, w.balance]).sort()).toEqual([
      ['RUB', 500_000n],
      ['USD', 0n],
    ]);
    expect(user.holders.map((h) => h.holderId)).toEqual(['basic']);
    const ledger = await t.prisma.ledgerEntry.findMany({ where: { userId: session.userId } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      reason: 'signup_bonus',
      delta: 500_000n,
      balanceAfter: 500_000n,
    });
  });

  it('logs an existing player in without a second bonus', async () => {
    const telegramId = nextTelegramId();
    const first = await login(t, { telegramId, firstName: 'Old' });
    const second = await login(t, { telegramId, firstName: 'New' });
    expect(second.userId).toBe(first.userId);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { id: first.userId } });
    expect(user.firstName).toBe('New');
    expect(await t.prisma.ledgerEntry.count({ where: { userId: first.userId } })).toBe(1);
  });

  it('creates exactly one player for parallel first logins', async () => {
    const telegramId = nextTelegramId();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => loginRaw(signInitData({ telegramId }))),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const users = await t.prisma.user.findMany({ where: { telegramId: BigInt(telegramId) } });
    expect(users).toHaveLength(1);
    expect(await t.prisma.ledgerEntry.count({ where: { userId: users[0]!.id } })).toBe(1);
  });

  it('links the referrer from start_param', async () => {
    const referrer = await login(t);
    const { referralCode } = await t.prisma.user.findUniqueOrThrow({
      where: { id: referrer.userId },
    });
    const invited = await login(t, { startParam: `ref_${referralCode}` });
    const user = await t.prisma.user.findUniqueOrThrow({
      where: { id: invited.userId },
      include: { referralOf: true },
    });
    expect(user.referrerId).toBe(referrer.userId);
    expect(user.referralOf?.status).toBe('pending');
  });

  it('flags a returning player for a lucky free spin', async () => {
    const telegramId = nextTelegramId();
    const session = await login(t, { telegramId });
    await t.prisma.user.update({
      where: { id: session.userId },
      data: { lastSeenAt: new Date(Date.now() - 73 * 3_600_000) },
    });
    await login(t, { telegramId });
    const user = await t.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(user.returnLuckyPending).toBe(true);
  });

  it('rejects forged and expired initData with codes', async () => {
    const forged = await loginRaw(signInitData({ botToken: '1:forged' }));
    expect(forged.statusCode).toBe(401);
    expect(forged.json()).toMatchObject({ error: { code: 'INVALID_INIT_DATA' } });

    const expired = await loginRaw(
      signInitData({ authDate: new Date(Date.now() - 2 * 86_400_000) }),
    );
    expect(expired.statusCode).toBe(401);
    expect(expired.json()).toMatchObject({ error: { code: 'INIT_DATA_EXPIRED' } });

    const invalid = await t.app.inject({ method: 'POST', url: '/v1/auth/telegram', payload: {} });
    expect(invalid.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('protects player routes', async () => {
    expect((await t.app.inject({ url: '/v1/me' })).statusCode).toBe(401);
    const bad = await t.app.inject({ url: '/v1/me', headers: { authorization: 'Bearer nope' } });
    expect(bad.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('blocks banned players', async () => {
    const session = await login(t);
    await t.prisma.user.update({ where: { id: session.userId }, data: { isBanned: true } });
    const res = await t.app.inject({ url: '/v1/me', headers: session.auth });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'USER_BANNED' } });
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const session = await login(t);
    const refresh = (refreshToken: string) =>
      t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } });

    const rotated = await refresh(session.refreshToken);
    expect(rotated.statusCode).toBe(200);
    const next = rotated.json<{ accessToken: string; refreshToken: string }>();
    expect(next.refreshToken).not.toBe(session.refreshToken);
    const me = await t.app.inject({
      url: '/v1/me',
      headers: { authorization: `Bearer ${next.accessToken}` },
    });
    expect(me.statusCode).toBe(200);

    // Replaying the old token kills the whole family, including the fresh one.
    expect((await refresh(session.refreshToken)).json()).toMatchObject({
      error: { code: 'INVALID_REFRESH_TOKEN' },
    });
    expect((await refresh(next.refreshToken)).statusCode).toBe(401);
  });

  it('logs out by revoking the refresh token', async () => {
    const session = await login(t);
    const out = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refreshToken: session.refreshToken },
    });
    expect(out.statusCode).toBe(204);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(res.statusCode).toBe(401);
  });

  it('has no dev login outside development', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/auth/dev', payload: {} });
    expect(res.statusCode).toBe(404);
  });
});

describe('dev login', () => {
  it('is available with NODE_ENV=development and DEV_AUTH_BYPASS=true', async () => {
    const t = await createTestApp({ NODE_ENV: 'development', DEV_AUTH_BYPASS: 'true' });
    try {
      const res = await t.app.inject({
        method: 'POST',
        url: '/v1/auth/dev',
        payload: { telegramId: nextTelegramId() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('accessToken');
    } finally {
      await t.close();
    }
  });
});

describe('rate limit', () => {
  it('answers RATE_LIMITED after the per-minute budget', async () => {
    const t = await createTestApp({ RATE_LIMIT_AUTH_PER_MIN: '3' });
    // Only this test's counters: other test files keep their own keys in the same Redis.
    const clear = async () => {
      const keys = await t.redis.keys('rl:auth:*203.0.113.77*');
      if (keys.length > 0) await t.redis.del(...keys);
    };
    try {
      await clear();
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        // Own client IP: parallel test files log in from 127.0.0.1 and share that counter.
        const res = await t.app.inject({
          method: 'POST',
          url: '/v1/auth/telegram',
          payload: {},
          headers: { 'x-forwarded-for': '203.0.113.77' },
        });
        statuses.push(res.statusCode);
      }
      expect(statuses).toEqual([400, 400, 400, 429]);
    } finally {
      await clear();
      await t.close();
    }
  });
});
