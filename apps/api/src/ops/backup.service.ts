import { execFile } from 'node:child_process';
import { link, mkdir, readdir, rename, rm, stat, statfs, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AdminOpsStatus, OpsRunStatus } from '@spincards/shared';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { findLedgerMismatches } from '../ledger/verify.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';
import { OpsAlertsService } from './alerts.service.js';

const run = promisify(execFile);
const STATUS_KEY = { backup: 'ops:status:backup', restoreCheck: 'ops:status:restore-check' };
const FILE = /^spincards-\d{8}-\d{6}(-[\w-]+)?\.dump$/;

/** `spincards-20261014-030000.dump` (UTC), so names sort by time. */
export function dumpName(at: Date, label?: string): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `spincards-${stamp}${label ? `-${label}` : ''}.dump`;
}

/** Dumps beyond the newest `keep` (names sort by time). */
export function expiredDumps(names: string[], keep: number): string[] {
  return names
    .filter((name) => FILE.test(name))
    .sort()
    .reverse()
    .slice(keep);
}

/** libpq variables instead of a URL argument: the password never shows in a process list. */
export function pgEnv(databaseUrl: string, database?: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  return {
    PATH: process.env.PATH,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database ?? decodeURIComponent(url.pathname.slice(1)),
  };
}

/** Error text without the password, short enough for an alert. */
function describe(error: unknown, secret: string): string {
  const err = error as { stderr?: string; message?: string };
  const text = (err.stderr?.trim() || err.message || String(error)).replace(secret, '***');
  return text.slice(0, 300);
}

/**
 * Database backups (D-117), run by the worker: a daily pg_dump (custom format) with rotation, a
 * Sunday copy kept as weekly, and a weekly restore check: the latest dump is restored into a
 * scratch database and its books are verified (every balance equals the sum of its ledger).
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly alerts: OpsAlertsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  get enabled(): boolean {
    return this.env.BACKUP_DIR !== '';
  }

  private dir(kind: 'daily' | 'weekly' | 'manual'): string {
    return join(this.env.BACKUP_DIR, kind);
  }

  /** pg_dump into `kind`; returns the file path. */
  async dump(kind: 'daily' | 'manual', now = new Date(), label?: string): Promise<string> {
    if (!this.enabled) throw new Error('BACKUP_DIR is not set');
    const dir = this.dir(kind);
    await mkdir(dir, { recursive: true });
    const file = join(dir, dumpName(now, label));
    const part = `${file}.part`;
    await run('pg_dump', ['--format=custom', '--compress=6', '--no-owner', `--file=${part}`], {
      env: pgEnv(this.env.DATABASE_URL),
      maxBuffer: 16 * 1024 * 1024,
    });
    await rename(part, file);
    return file;
  }

  /** The scheduled daily backup with rotation; alerts on failure. */
  async backup(now = new Date()): Promise<OpsRunStatus> {
    const started = Date.now();
    let status: OpsRunStatus;
    try {
      const file = await this.dump('daily', now);
      const name = file.slice(file.lastIndexOf('/') + 1);
      if (now.getUTCDay() === 0) {
        await mkdir(this.dir('weekly'), { recursive: true });
        const weekly = join(this.dir('weekly'), name);
        // A hard link costs no space; copy when the folders are on different disks.
        await link(file, weekly).catch(() => copyFile(file, weekly));
      }
      await this.rotate('daily', this.env.BACKUP_KEEP_DAILY);
      await this.rotate('weekly', this.env.BACKUP_KEEP_WEEKLY);
      await this.rotate('manual', this.env.BACKUP_KEEP_DAILY);
      status = {
        at: now.toISOString(),
        ok: true,
        file: name,
        sizeBytes: (await stat(file)).size,
        durationMs: Date.now() - started,
      };
      await this.alerts.reset('backup');
    } catch (error) {
      const message = describe(error, pgEnv(this.env.DATABASE_URL).PGPASSWORD ?? '');
      this.logger.error({ err: message }, 'backup failed');
      status = { at: now.toISOString(), ok: false, error: message };
      await this.alerts.send('backup', 'backupFailed', { error: message });
    }
    await this.redis.set(STATUS_KEY.backup, JSON.stringify(status));
    return status;
  }

  /** Restores the newest daily dump into a scratch database and verifies the ledger there. */
  async restoreCheck(now = new Date()): Promise<OpsRunStatus> {
    const started = Date.now();
    const scratch = `${pgEnv(this.env.DATABASE_URL).PGDATABASE ?? 'spincards'}_restore_check`;
    let status: OpsRunStatus;
    let file: string | undefined;
    try {
      file = (await this.list('daily'))[0]?.name;
      if (!file) throw new Error('no daily dump to check');
      await this.prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
      await this.prisma.$executeRawUnsafe(`CREATE DATABASE "${scratch}"`);
      // pg_restore ignores PGDATABASE: the target database is named explicitly.
      await run(
        'pg_restore',
        ['--no-owner', '--exit-on-error', `--dbname=${scratch}`, join(this.dir('daily'), file)],
        {
          env: pgEnv(this.env.DATABASE_URL, scratch),
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      const url = new URL(this.env.DATABASE_URL);
      url.pathname = `/${scratch}`;
      const client = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString() }),
      });
      try {
        const mismatches = await findLedgerMismatches(client);
        const [count] = await client.$queryRaw<{ n: bigint }[]>`
          SELECT (SELECT count(*) FROM wallets) + (SELECT count(*) FROM cards) AS n`;
        status = {
          at: now.toISOString(),
          ok: mismatches.length === 0,
          file,
          accounts: Number(count?.n ?? 0),
          mismatches: mismatches.length,
          durationMs: Date.now() - started,
        };
      } finally {
        await client.$disconnect();
      }
      if (status.ok) await this.alerts.reset('restore-check');
      else
        await this.alerts.send('restore-check', 'restoreMismatch', {
          file,
          mismatches: status.mismatches ?? 0,
        });
    } catch (error) {
      const message = describe(error, pgEnv(this.env.DATABASE_URL).PGPASSWORD ?? '');
      this.logger.error({ err: message }, 'restore check failed');
      status = {
        at: now.toISOString(),
        ok: false,
        ...(file && { file }),
        error: message,
      };
      await this.alerts.send('restore-check', 'restoreFailed', { error: message });
    } finally {
      await this.prisma
        .$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`)
        .catch(() => undefined);
    }
    await this.redis.set(STATUS_KEY.restoreCheck, JSON.stringify(status));
    return status;
  }

  /**
   * Replaces the database with a dump (`--clean`); api, worker and bot must be stopped. A safety
   * dump of the current state is taken first.
   */
  async restore(file: string): Promise<string> {
    const safety = await this.dump('manual', new Date(), 'pre-restore');
    const env = pgEnv(this.env.DATABASE_URL);
    await run(
      'pg_restore',
      [
        '--clean',
        '--if-exists',
        '--no-owner',
        '--single-transaction',
        '--exit-on-error',
        `--dbname=${env.PGDATABASE ?? ''}`,
        file,
      ],
      { env, maxBuffer: 16 * 1024 * 1024 },
    );
    return safety;
  }

  async status(): Promise<AdminOpsStatus> {
    const read = async (key: string) => {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as OpsRunStatus) : null;
    };
    const [backup, restoreCheck] = await Promise.all([
      read(STATUS_KEY.backup),
      read(STATUS_KEY.restoreCheck),
    ]);
    if (!this.enabled)
      return { backupsEnabled: false, backup, restoreCheck, disk: null, files: [] };
    const files = [
      ...(await this.list('daily')),
      ...(await this.list('weekly')),
      ...(await this.list('manual')),
    ];
    const unique = [...new Map(files.map((f) => [f.name, f])).values()];
    unique.sort((a, b) => b.name.localeCompare(a.name));
    return {
      backupsEnabled: true,
      backup,
      restoreCheck,
      disk: await this.disk(),
      files: unique.slice(0, 20),
    };
  }

  /** Free and total bytes of the backup folder's disk (usually the server's only disk). */
  async disk(): Promise<{ freeBytes: number; totalBytes: number } | null> {
    if (!this.enabled) return null;
    await mkdir(this.env.BACKUP_DIR, { recursive: true });
    const fs = await statfs(this.env.BACKUP_DIR);
    return { freeBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize };
  }

  /** Dumps of one folder, newest first. */
  async list(kind: 'daily' | 'weekly' | 'manual') {
    const names = await readdir(this.dir(kind)).catch(() => [] as string[]);
    const dumps = names
      .filter((name) => FILE.test(name))
      .sort()
      .reverse();
    return Promise.all(
      dumps.map(async (name) => {
        const info = await stat(join(this.dir(kind), name));
        return { name, sizeBytes: info.size, at: info.mtime.toISOString() };
      }),
    );
  }

  private async rotate(kind: 'daily' | 'weekly' | 'manual', keep: number): Promise<void> {
    const names = await readdir(this.dir(kind)).catch(() => [] as string[]);
    for (const name of expiredDumps(names, keep)) await rm(join(this.dir(kind), name));
    // Leftovers of an interrupted dump (old enough not to be one in progress).
    for (const name of names.filter((n) => n.endsWith('.part'))) {
      const path = join(this.dir(kind), name);
      const info = await stat(path).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 6 * 3600_000) await rm(path, { force: true });
    }
  }
}
