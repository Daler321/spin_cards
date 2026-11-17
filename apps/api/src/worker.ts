import 'reflect-metadata';
import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { DailyStatsService } from './analytics/daily-stats.service.js';
import { loadEnv } from './config/env.js';
import { LifecycleService } from './game/lifecycle.service.js';
import { NickCheckService } from './game/nick-check.service.js';
import { ReferralCommissionService } from './game/referral.service.js';
import { LeaderboardService } from './leaderboard/leaderboard.service.js';
import { NotificationScannerService } from './notifications/notification-scanner.service.js';
import { BackupService } from './ops/backup.service.js';
import { HygieneService } from './ops/hygiene.service.js';
import { SeasonRolloverService } from './game/season-rollover.service.js';
import { OpsWatchService } from './ops/watch.service.js';
import { SafeguardsService } from './safeguards/safeguards.service.js';
import { WorkerModule } from './worker.module.js';

const QUEUE = 'maintenance';
const SECOND = 1000;
const MINUTE = 60 * SECOND;

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = pino({ level: env.LOG_LEVEL, base: { service: 'worker' } });
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), {
    logger: false,
  });
  const lifecycle = app.get(LifecycleService);
  const scanner = app.get(NotificationScannerService);
  const leaderboard = app.get(LeaderboardService);
  const stats = app.get(DailyStatsService);
  const safeguards = app.get(SafeguardsService);
  const commission = app.get(ReferralCommissionService);
  const backups = app.get(BackupService);
  const watch = app.get(OpsWatchService);
  const hygiene = app.get(HygieneService);
  const rollover = app.get(SeasonRolloverService);
  const nickCheck = app.get(NickCheckService);
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  // `every` (ms) or a cron `pattern` (UTC).
  const jobs: Record<
    string,
    { every?: number; pattern?: string; run: () => Promise<unknown> } | undefined
  > = {
    'card-lifecycle': { every: MINUTE, run: () => lifecycle.run() },
    'notification-scan': { every: MINUTE, run: () => scanner.run() },
    // Rating (TZ 7.3): changed players every 10 s, a full rebuild hourly, snapshots every 5 min.
    'leaderboard-sync': { every: 10 * SECOND, run: () => leaderboard.sync() },
    'leaderboard-rebuild': { every: 60 * MINUTE, run: () => leaderboard.rebuild() },
    'leaderboard-snapshot': { every: 5 * MINUTE, run: () => leaderboard.snapshot() },
    'daily-stats': { every: 60 * MINUTE, run: () => stats.runRecent() },
    safeguards: { every: 5 * MINUTE, run: () => safeguards.run() },
    'referral-commission': { every: 10 * MINUTE, run: () => commission.run() },
    // D-117: watching, daily backups and the weekly restore check.
    'ops-watch': { every: MINUTE, run: () => watch.run() },
    // D-173: names of active players, each re-read every checkHours.
    'nick-check': { every: 5 * MINUTE, run: () => nickCheck.run() },
    // D-125: closes a finished season and opens the next one.
    'season-rollover': { every: MINUTE, run: () => rollover.run() },
    // D-118: old idempotency keys, expired tokens and sessions.
    hygiene: { pattern: '0 4 * * *', run: () => hygiene.run() },
    ...(backups.enabled && {
      backup: { pattern: env.BACKUP_CRON, run: () => backups.backup() },
      'restore-check': { pattern: env.RESTORE_CHECK_CRON, run: () => backups.restoreCheck() },
    }),
  };

  // Repeatable jobs: BullMQ keeps one schedule however many workers run.
  const queue = new Queue(QUEUE, { connection });
  for (const [name, job] of Object.entries(jobs)) {
    if (!job) continue;
    await queue.upsertJobScheduler(
      name,
      job.pattern ? { pattern: job.pattern, tz: 'UTC' } : { every: job.every },
      { name },
    );
  }
  // Schedules of jobs that were switched off (e.g. backups without BACKUP_DIR).
  for (const scheduler of await queue.getJobSchedulers()) {
    if (scheduler.key && !jobs[scheduler.key]) await queue.removeJobScheduler(scheduler.key);
  }

  const worker = new Worker(
    QUEUE,
    async (job) => {
      const handler = jobs[job.name];
      if (handler) return handler.run();
      logger.warn({ name: job.name }, 'unknown job');
      return null;
    },
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, error) => {
    logger.error({ err: error, job: job?.name }, 'job failed');
  });
  worker.on('error', (error) => {
    logger.error({ err: error }, 'worker error');
  });

  const health = createServer((req, res) => {
    const ok = req.url === '/health' && worker.isRunning() && connection.status === 'ready';
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: ok ? 'ok' : 'fail' }));
  });
  health.listen(env.WORKER_HEALTH_PORT, '0.0.0.0');
  logger.info({ queue: QUEUE, jobs: Object.keys(jobs) }, 'worker started');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'worker shutting down');
    health.close();
    await worker.close();
    await queue.close();
    connection.disconnect();
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', (signal) => void shutdown(signal));
  process.once('SIGINT', (signal) => void shutdown(signal));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
