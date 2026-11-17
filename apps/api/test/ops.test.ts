import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdminOpsTestResult } from '@spincards/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { alertText, OpsAlertsService } from '../src/ops/alerts.service.js';
import { BackupService, dumpName, expiredDumps, pgEnv } from '../src/ops/backup.service.js';
import { countServerError, OpsWatchService } from '../src/ops/watch.service.js';
import { createTestApp, login, type TestApp } from './support/app.js';

describe('ops helpers', () => {
  it('names dumps by UTC time and keeps the newest', () => {
    expect(dumpName(new Date('2026-10-14T03:00:05Z'))).toBe('spincards-20261014-030005.dump');
    expect(dumpName(new Date('2026-10-14T03:00:05Z'), 'pre-restore')).toBe(
      'spincards-20261014-030005-pre-restore.dump',
    );
    const names = [
      'spincards-20261012-030000.dump',
      'spincards-20261014-030000.dump',
      'spincards-20261013-030000.dump',
      'notes.txt',
      'spincards-20261011-030000.dump.part',
    ];
    expect(expiredDumps(names, 2)).toEqual(['spincards-20261012-030000.dump']);
  });

  it('passes credentials through libpq variables', () => {
    expect(pgEnv('postgresql://u%40x:p%2Fw@db:6543/game')).toMatchObject({
      PGHOST: 'db',
      PGPORT: '6543',
      PGUSER: 'u@x',
      PGPASSWORD: 'p/w',
      PGDATABASE: 'game',
    });
    expect(pgEnv('postgresql://u:p@db/game', 'other').PGDATABASE).toBe('other');
  });

  it('renders alert texts with escaped values', () => {
    expect(alertText('serviceDown', { name: 'api', error: '<timeout>' })).toBe(
      '🔴 SpinCards: сервис api не отвечает (&lt;timeout&gt;).',
    );
  });
});

describe('ops (D-117)', () => {
  let t: TestApp;
  let dir: string;
  const sent: { chat_id: string; text: string }[] = [];
  const stubTelegram = (ok = true) => {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (!url.includes('/sendMessage')) return Promise.reject(new Error('unreachable'));
      sent.push(JSON.parse(init?.body as string) as { chat_id: string; text: string });
      return Promise.resolve(
        new Response(JSON.stringify(ok ? { ok: true, result: {} } : { ok: false }), {
          status: ok ? 200 : 400,
        }),
      );
    });
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spincards-backup-'));
    t = await createTestApp({
      BACKUP_DIR: dir,
      OPS_HEALTH_URLS: 'ghost=http://127.0.0.1:9/health',
      OPS_5XX_ALERT: '3',
    });
    // This app instance only: the settings table is shared with other test files.
    t.app.get(OpsAlertsService).settings = () => Promise.resolve({ alertChatIds: ['42', '-100'] });
  });
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sent.length = 0;
  });

  it('sends an alert to every recipient once per window', async () => {
    stubTelegram();
    const alerts = t.app.get(OpsAlertsService);
    const key = `test:${String(Date.now())}`;
    expect(await alerts.send(key, 'diskLow', { free: '1.5', pct: 4 })).toBe(true);
    expect(await alerts.send(key, 'diskLow', { free: '1.5', pct: 4 })).toBe(false);
    expect(sent.map((m) => m.chat_id)).toEqual(['42', '-100']);
    expect(sent[0]?.text).toContain('1.5 ГБ (4%)');
    await alerts.reset(key);
    expect(await alerts.send(key, 'diskLow', { free: '1.5', pct: 4 })).toBe(true);
  });

  it('reports the test delivery per chat', async () => {
    stubTelegram(false);
    const results: AdminOpsTestResult[] = await t.app.get(OpsAlertsService).test(['7']);
    expect(results).toEqual([{ chatId: '7', ok: false, error: expect.any(String) as string }]);
  });

  it('dumps the database, rotates old dumps and verifies a restore', async () => {
    stubTelegram();
    const backups = t.app.get(BackupService);
    await login(t); // at least one wallet to restore and verify
    await mkdir(join(dir, 'daily'), { recursive: true });
    for (const day of ['01', '02', '03', '04', '05', '06', '07', '08'])
      await writeFile(join(dir, 'daily', `spincards-202610${day}-030000.dump`), 'old');

    // A Sunday: the daily dump is also kept as weekly.
    const status = await backups.backup(new Date('2026-10-18T03:00:00Z'));
    expect(status).toMatchObject({ ok: true, file: 'spincards-20261018-030000.dump' });
    expect(status.sizeBytes).toBeGreaterThan(1000);
    const daily = (await readdir(join(dir, 'daily'))).sort();
    expect(daily).toHaveLength(7);
    expect(daily.at(-1)).toBe('spincards-20261018-030000.dump');
    expect(daily).not.toContain('spincards-20261002-030000.dump');
    expect(await readdir(join(dir, 'weekly'))).toEqual(['spincards-20261018-030000.dump']);

    const check = await backups.restoreCheck();
    expect(check).toMatchObject({
      ok: true,
      file: 'spincards-20261018-030000.dump',
      mismatches: 0,
    });
    expect(check.accounts).toBeGreaterThan(0);
    const scratch = await t.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_database WHERE datname LIKE '%_restore_check'`;
    expect(scratch[0]?.n).toBe(0n);

    const overview = await backups.status();
    expect(overview.backup?.ok).toBe(true);
    expect(overview.restoreCheck?.ok).toBe(true);
    expect(overview.disk?.totalBytes).toBeGreaterThan(0);
    expect(overview.files[0]?.name).toBe('spincards-20261018-030000.dump');
    expect(sent).toEqual([]);
  }, 60_000);

  it('alerts when a dump cannot be restored', async () => {
    stubTelegram();
    await t.app.get(OpsAlertsService).reset('restore-check');
    // The newest daily file is garbage.
    await writeFile(join(dir, 'daily', 'spincards-20991231-030000.dump'), 'not a dump');
    const check = await t.app.get(BackupService).restoreCheck();
    expect(check.ok).toBe(false);
    expect(check.error).toBeTruthy();
    expect(sent.some((m) => m.text.includes('проверка восстановления'))).toBe(true);
    await rm(join(dir, 'daily', 'spincards-20991231-030000.dump'));
  }, 60_000);

  it('alerts on a service that stays down and on a burst of 5xx', async () => {
    stubTelegram();
    const watch = t.app.get(OpsWatchService);
    await t.redis.del('ops:down:ghost', 'ops:alert:down:ghost', 'ops:alert:5xx');
    const now = Date.now();
    for (let i = 0; i < 3; i++) await countServerError(t.redis, now);

    const first = await watch.run(now);
    expect(first.down).toEqual(['ghost']);
    expect(first.errors).toBeGreaterThanOrEqual(3);
    expect(sent.filter((m) => m.text.includes('ghost'))).toEqual([]);
    expect(sent.filter((m) => m.text.includes('ошибок сервера'))).toHaveLength(2);

    await watch.run(now);
    // The second failed check alerts both recipients.
    expect(sent.filter((m) => m.text.includes('ghost'))).toHaveLength(2);
  });
});
