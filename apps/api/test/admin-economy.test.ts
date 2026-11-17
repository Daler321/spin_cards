import type {
  AdminAlert,
  AdminConfigDetail,
  AdminConfigVersion,
  AdminStatRow,
  ConfigDiffEntry,
  ConfigIssue,
  ConfigSimulationReport,
  GameConfig,
  PublicConfigResponse,
  SpinResponse,
} from '@spincards/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diffConfig } from '../src/admin/config-diff.js';
import { encryptSecret, newTotpSecret, totpCode } from '../src/admin/totp.js';
import { FlagsService } from '../src/game-config/flags.service.js';
import { GameConfigService } from '../src/game-config/game-config.service.js';
import { SafeguardsService } from '../src/safeguards/safeguards.service.js';
import { hashPassword } from '../src/seed/password.js';
import { createTestApp, login, patchConfig, post, type TestApp } from './support/app.js';

const SECRET_KEY = 'test-admin-secret-key-test-admin-secret-key';
type ErrorBody = { error: { code: string } };

describe('diffConfig', () => {
  it('reports leaf changes and matches arrays of objects by id', () => {
    expect(
      diffConfig(
        {
          a: 1,
          packs: [
            { id: 'x', w: 1 },
            { id: 'y', w: 2 },
          ],
          list: [1, 2],
        },
        {
          a: 1,
          packs: [
            { id: 'y', w: 3 },
            { id: 'x', w: 1 },
          ],
          list: [1, 3],
          b: true,
        },
      ),
    ).toEqual([
      { path: 'packs[y].w', from: 2, to: 3 },
      { path: 'list.1', from: 2, to: 3 },
      { path: 'b', from: null, to: true },
    ]);
  });
});

describe('admin economy', () => {
  let t: TestApp;
  let owner: Record<string, string>;
  let analyst: Record<string, string>;

  async function session(role: 'owner' | 'analyst') {
    const loginName = `adm-${randomUUID().slice(0, 8)}`;
    const secret = newTotpSecret();
    await t.prisma.adminUser.create({
      data: {
        login: loginName,
        passwordHash: await hashPassword('pa55word!'),
        role,
        totpSecret: encryptSecret(secret, SECRET_KEY),
      },
    });
    const res = await t.app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: {
        login: loginName,
        password: 'pa55word!',
        totp: totpCode(secret, Math.floor(Date.now() / 30_000)),
      },
    });
    return {
      cookie: String(res.headers['set-cookie']).split(';')[0] ?? '',
      'x-admin-request': '1',
    };
  }

  const call = async <T>(
    headers: Record<string, string>,
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
  ) => {
    const res = await t.app.inject({ method, url, headers, ...(payload && { payload }) });
    return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
  };

  beforeAll(async () => {
    t = await createTestApp();
    owner = await session('owner');
    analyst = await session('analyst');
  });
  afterAll(() => t.close());

  it('runs a version through draft, simulation, activation and rollback', async () => {
    const active = await t.prisma.gameConfigVersion.findFirstOrThrow({
      where: { status: 'active' },
    });
    const payload = structuredClone(active.payload) as GameConfig;
    // Only the simulation corridor changes: other test files keep playing with this config.
    payload.simulation = { ...payload.simulation, rtpCorridor: { minBp: 1, maxBp: 1_000_000 } };

    const broken = { ...payload, packs: [] };
    const issues = await call<{ issues: ConfigIssue[] }>(
      analyst,
      'POST',
      '/admin/configs/validate',
      {
        payload: broken,
      },
    );
    expect(issues.body.issues[0]?.path).toBe('packs');
    expect(
      (
        await call<ErrorBody>(owner, 'POST', '/admin/configs', {
          payload: broken,
          comment: 'сломан',
        })
      ).body.error.code,
    ).toBe('CONFIG_INVALID');
    expect(
      (await call(analyst, 'POST', '/admin/configs', { payload, comment: 'аналитик' })).status,
    ).toBe(403);

    const draft = await call<AdminConfigVersion>(owner, 'POST', '/admin/configs', {
      payload,
      comment: 'широкий коридор',
    });
    expect(draft.body).toMatchObject({ status: 'draft', simulationOk: null });
    const id = draft.body.id;

    const diff = await call<ConfigDiffEntry[]>(analyst, 'GET', `/admin/configs/${String(id)}/diff`);
    expect(diff.body.map((d) => d.path).sort()).toEqual([
      'simulation.rtpCorridor.maxBp',
      'simulation.rtpCorridor.minBp',
    ]);

    const early = await call<ErrorBody>(owner, 'POST', `/admin/configs/${String(id)}/activate`, {
      reason: 'рано',
    });
    expect(early.body.error.code).toBe('CONFIG_NOT_SIMULATED');

    const sim = await call<ConfigSimulationReport>(
      owner,
      'POST',
      `/admin/configs/${String(id)}/simulate`,
      {
        spins: 2000,
      },
    );
    expect(sim.body.ok).toBe(true);
    expect(sim.body.items.length).toBeGreaterThan(0);
    expect(sim.body.items.every((i) => i.rtpBp !== null && i.spins === 2000)).toBe(true);
    // D-141: every pack is also checked with the best card at the luck cap.
    const scenarios = new Set(sim.body.items.map((i) => `${i.packId}:${i.region}:${i.scenario}`));
    for (const item of sim.body.items) {
      expect(scenarios.has(`${item.packId}:${item.region}:regular`)).toBe(true);
      expect(scenarios.has(`${item.packId}:${item.region}:bestCard`)).toBe(true);
    }
    const detail = await call<AdminConfigDetail>(owner, 'GET', `/admin/configs/${String(id)}`);
    expect(detail.body).toMatchObject({ status: 'simulated', simulationOk: true });

    const config = t.app.get(GameConfigService);
    expect(
      (
        await call(owner, 'POST', `/admin/configs/${String(id)}/activate`, {
          reason: 'проверка выкладки',
        })
      ).status,
    ).toBe(204);
    expect((await config.active()).versionId).toBe(id);
    expect(
      (await t.prisma.gameConfigVersion.findUniqueOrThrow({ where: { id: active.id } })).status,
    ).toBe('archived');

    // Rollback: the previous version comes back.
    expect(
      (
        await call(owner, 'POST', `/admin/configs/${String(active.id)}/activate`, {
          reason: 'откат',
        })
      ).status,
    ).toBe(204);
    expect((await config.active()).versionId).toBe(active.id);
    const audit = await t.prisma.auditLog.findMany({
      where: {
        action: { startsWith: 'config.' },
        targetId: { in: [String(id), String(active.id)] },
      },
      orderBy: { id: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'config.draft',
      'config.simulate',
      'config.activate',
      'config.rollback',
    ]);

    // Editing a simulated version voids the simulation.
    const archivedEdit = await call<ErrorBody>(owner, 'POST', `/admin/configs/${String(id)}`, {
      payload,
      comment: 'правка архивной',
    });
    expect(archivedEdit.body.error.code).toBe('CONFIG_NOT_EDITABLE');
  });

  it('gives a player in an experiment group the bound version', async () => {
    const active = await t.prisma.gameConfigVersion.findFirstOrThrow({
      where: { status: 'active' },
    });
    const variant = await t.prisma.gameConfigVersion.create({
      data: { payload: active.payload ?? {}, status: 'simulated', comment: 'A/B' },
    });
    const group = `ab-${randomUUID().slice(0, 6)}`;
    expect(
      (
        await call(owner, 'POST', `/admin/experiments/${group}`, {
          versionId: variant.id,
          reason: 'тест A/B',
        })
      ).status,
    ).toBe(204);
    const player = await login(t);
    await call(owner, 'POST', `/admin/users/${player.userId}/experiment`, {
      group,
      reason: 'в группу',
    });
    const spin = await post<SpinResponse>(t, player, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    const stored = await t.prisma.spin.findUniqueOrThrow({
      where: { id: spin.body.spins[0]!.spinId },
    });
    expect(stored.configVersionId).toBe(variant.id);
    const list = await call<{ group: string; users: number }[]>(
      analyst,
      'GET',
      '/admin/experiments',
    );
    expect(list.body.find((e) => e.group === group)).toMatchObject({ users: 1 });
  });

  it('pauses a pack whose factual RTP runs away and alerts once', async () => {
    const packId = `runaway_${randomUUID().slice(0, 6)}`;
    await patchConfig(t, (c) => {
      // Only an absurd RTP trips it, so real packs played by other tests never do.
      c.safeguards.rtp = {
        windowMinutes: 60,
        minSpins: 3,
        minBp: 0,
        maxBp: 1_000_000_000,
        autoPause: true,
      };
    });
    const season = await t.prisma.season.findFirstOrThrow({ where: { status: 'active' } });
    await t.prisma.event.createMany({
      data: Array.from({ length: 3 }, () => ({
        seasonId: season.id,
        name: 'spin',
        props: { packId, currency: 'RUB', price: 1, issued: 1_000_000_000 },
      })),
    });
    const safeguards = t.app.get(SafeguardsService);
    await safeguards.run();
    await safeguards.run();
    const flag = await t.prisma.featureFlag.findUniqueOrThrow({
      where: { key: `pack_paused:${packId}` },
    });
    expect(flag).toMatchObject({ enabled: true, updatedBy: 'safeguard' });
    expect(await t.app.get(FlagsService).isPackPaused(packId)).toBe(true);
    const alerts = await call<AdminAlert[]>(analyst, 'GET', '/admin/alerts');
    expect(
      alerts.body.filter((a) => (a.payload as { packId?: string }).packId === packId),
    ).toHaveLength(1);
  });

  it('rejects spins of a paused pack and hides it from the public config', async () => {
    const local = await createTestApp();
    try {
      const flags = local.app.get(FlagsService);
      flags.isPackPaused = (id) => Promise.resolve(id === 'basic');
      const player = await login(local);
      const res = await post<ErrorBody>(local, player, '/v1/spin', {
        packId: 'basic',
        payment: { type: 'wallet' },
      });
      expect(res.body.error.code).toBe('PACK_NOT_AVAILABLE');
      const config = await local.app.inject({ url: '/v1/config/public' });
      const ids = config.json<PublicConfigResponse>().packs.map((p) => p.id);
      expect(ids).not.toContain('basic');
      expect(ids).toContain('business');
    } finally {
      await local.close();
    }
  });

  it('serves daily stats to analysts', async () => {
    await call(analyst, 'POST', '/admin/stats/recompute');
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const rows = await call<AdminStatRow[]>(
      analyst,
      'GET',
      `/admin/stats?from=${from}&to=${today}&metrics=new_users,dau`,
    );
    expect(rows.status).toBe(200);
    expect(rows.body.length).toBeGreaterThan(0);
    expect(rows.body.every((r) => ['new_users', 'dau'].includes(r.metric))).toBe(true);
  });
});
