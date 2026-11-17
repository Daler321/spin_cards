import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG, GameConfigSchema } from '@spincards/shared';
import { fillMissing } from '../src/seed/config-upgrade.js';
import { verifyPassword } from '../src/seed/password.js';
import { seed } from '../src/seed/seed.js';
import { createTestApp, type TestApp } from './support/app.js';
import { testEnv } from './support/env.js';

describe('seed', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  it('creates reference data once', async () => {
    const counts = async () => ({
      currencies: await t.prisma.currency.count(),
      banks: await t.prisma.bank.count(),
      holders: await t.prisma.holder.count(),
      seasons: await t.prisma.season.count({ where: { status: 'active' } }),
      configs: await t.prisma.gameConfigVersion.count({ where: { status: 'active' } }),
      rates: await t.prisma.exchangeRate.count(),
      // Pack pauses come and go with the RTP safeguard in other test files.
      flags: await t.prisma.featureFlag.count({
        where: { key: { not: { startsWith: 'pack_paused:' } } },
      }),
    });
    const before = await counts();
    expect(before).toEqual({
      currencies: 2,
      banks: 8,
      holders: 4,
      seasons: 1,
      configs: 1,
      rates: 2,
      flags: 7,
    });

    const summary = await seed(t.prisma, testEnv());
    expect(summary).toEqual({
      configVersionCreated: false,
      configUpgraded: false,
      seasonCreated: false,
      ratesCreated: 0,
      adminCreated: false,
    });
    expect(await counts()).toEqual(before);
  });

  it('creates the owner admin from env with a hashed password', async () => {
    const login = `owner-${Date.now()}`;
    const summary = await seed(
      t.prisma,
      testEnv({ ADMIN_OWNER_LOGIN: login, ADMIN_OWNER_PASSWORD: 's3cret-pass' }),
    );
    expect(summary.adminCreated).toBe(true);
    const admin = await t.prisma.adminUser.findUniqueOrThrow({ where: { login } });
    expect(admin.role).toBe('owner');
    expect(admin.passwordHash).not.toContain('s3cret');
    expect(await verifyPassword('s3cret-pass', admin.passwordHash)).toBe(true);
    expect(await verifyPassword('wrong', admin.passwordHash)).toBe(false);
  });
});

describe('config schema upgrade', () => {
  it('fills keys added by a newer schema and keeps tuned values', () => {
    const old = structuredClone(DEFAULT_GAME_CONFIG) as unknown as Record<string, unknown>;
    delete old.lifecycle;
    delete old.daily;
    const packs = old.packs as Record<string, unknown>[];
    delete packs[1]!.unlockLevel;
    (packs[1]!.prices as Record<string, number>).RUB = 123_400;

    expect(GameConfigSchema.safeParse(old).success).toBe(false);
    const upgraded = GameConfigSchema.parse(fillMissing(old, DEFAULT_GAME_CONFIG));
    expect(upgraded.lifecycle).toEqual(DEFAULT_GAME_CONFIG.lifecycle);
    expect(upgraded.packs[1]).toMatchObject({ unlockLevel: 1, prices: { RUB: 123_400 } });
  });
});
