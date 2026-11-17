import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GameConfigService } from '../src/game-config/game-config.service.js';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import { RegionMergeService } from '../src/ops/region-merge.js';
import { createTestApp, fund, login, type TestApp } from './support/app.js';

describe('profile and public config', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  it('GET /v1/me returns profile, level and wallets', async () => {
    const session = await login(t, { firstName: 'Аня' });
    const res = await t.app.inject({ url: '/v1/me', headers: session.auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      firstName: 'Аня',
      region: 'RU',
      level: 1,
      exp: 0,
      nextLevelExp: 130,
      wallets: [
        { currency: 'RUB', balance: 500_000 },
        { currency: 'USD', balance: 0 },
      ],
      settings: { notificationsEnabled: true, hideFromLeaderboard: false },
    });
    expect(res.json<{ referralCode: string }>().referralCode).toMatch(/^[A-Z2-9]{8}$/);
  });

  it('moves players to rubles with the start money once, keeping other money (D-156)', async () => {
    const merge = t.app.get(RegionMergeService);
    // Signed up in this season: already had the ruble start money.
    const fresh = await login(t);
    await t.prisma.user.update({ where: { id: fresh.userId }, data: { region: 'US' } });
    // From an earlier season (no start money in rubles this season), with dollars left.
    const old = await t.prisma.user.create({
      data: {
        telegramId: BigInt(9_000_000_000 + Math.floor(Math.random() * 1_000_000)),
        firstName: 'Old',
        referralCode: `T${String(Date.now()).slice(-7)}`,
        region: 'US',
      },
    });
    await t.prisma.wallet.createMany({
      data: [
        { userId: old.id, currency: 'RUB' },
        { userId: old.id, currency: 'USD' },
      ],
    });
    await fund(t, old.id, 'USD', 1_500n);
    const userIds = [fresh.userId, old.id];

    expect(await merge.run({ reason: 'test', confirm: false, userIds })).toEqual({
      players: 2,
      moved: 0,
      credited: 0,
    });
    expect(await merge.run({ reason: 'test', confirm: true, userIds })).toEqual({
      players: 2,
      moved: 2,
      credited: 1,
    });
    expect(await merge.run({ reason: 'test', confirm: true, userIds })).toMatchObject({
      moved: 0,
    });

    const wallets = await t.prisma.wallet.findMany({ where: { userId: { in: userIds } } });
    const balance = (userId: string, currency: string) =>
      wallets.find((w) => w.userId === userId && w.currency === currency)?.balance;
    const { config } = await t.app.get(GameConfigService).active();
    const start = BigInt(config.startingBalance.RUB ?? 0);
    expect(balance(fresh.userId, 'RUB')).toBe(start);
    expect(balance(old.id, 'RUB')).toBe(start);
    expect(balance(old.id, 'USD')).toBe(1_500n);
    const users = await t.prisma.user.findMany({ where: { id: { in: userIds } } });
    expect(users.every((u) => u.region === 'RU')).toBe(true);
    expect(
      await t.prisma.auditLog.count({
        where: { action: 'user.region_merge', targetId: { in: userIds } },
      }),
    ).toBe(2);
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('switches the region', async () => {
    const session = await login(t);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/me/region',
      headers: session.auth,
      payload: { region: 'US' },
    });
    expect(res.json()).toMatchObject({ region: 'US' });
    const bad = await t.app.inject({
      method: 'POST',
      url: '/v1/me/region',
      headers: session.auth,
      payload: { region: 'EU' },
    });
    expect(bad.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('GET /v1/config/public publishes odds without Stars-only packs', async () => {
    const res = await t.app.inject({ url: '/v1/config/public' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      packs: { id: string; oddsBp: Record<string, number>; starsPrice: number | null }[];
      levels: unknown[];
      conversion: { rates: { fromCurrency: string; rateNano: string; feeBp: number }[] };
    }>();
    expect(body.packs.map((p) => p.id)).toEqual(['free', 'basic', 'business', 'premium']);
    expect(body.packs.find((p) => p.id === 'basic')?.oddsBp).toEqual({
      common: 8500,
      rare: 1200,
      epic: 280,
      legendary: 20,
      mythic: 0,
    });
    expect(body.packs.every((p) => p.starsPrice === null)).toBe(true);
    expect(body.levels).toHaveLength(300);
    expect((body as unknown as { banks: unknown[] }).banks).toHaveLength(8);
    expect(body.conversion.rates).toContainEqual({
      fromCurrency: 'USD',
      toCurrency: 'RUB',
      rateNano: '90000000000',
      feeBp: 300,
    });
    expect(JSON.stringify(body)).not.toMatch(/noPatternWeight|redropChance/);
  });
});
