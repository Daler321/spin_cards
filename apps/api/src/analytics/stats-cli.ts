/**
 * `make stats DATE=2026-10-13`: recomputes that day (today by default, in the analytics timezone)
 * and prints its metrics. A stopgap until the admin dashboard (M8).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '../config/env.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { WorkerModule } from '../worker.module.js';
import { DailyStatsService } from './daily-stats.service.js';
import { localDate } from './metrics.js';

const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(loadEnv()), {
  logger: false,
});
try {
  const { config } = await app.get(GameConfigService).active();
  const today = localDate(new Date(), config.analytics.timezone);
  const date = process.env.DATE || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('DATE must look like 2026-10-13');
  const stats = app.get(DailyStatsService);
  const rows = [
    ...(await stats.computeDay(date, { snapshot: date === today })),
    ...(await stats.computeCohort(date, today)),
  ];
  process.stdout.write(`metrics for ${date} (${config.analytics.timezone})\n`);
  for (const row of rows.sort((a, b) =>
    (a.metric + a.dimension).localeCompare(b.metric + b.dimension),
  ))
    process.stdout.write(
      `${row.metric.padEnd(30)} ${row.dimension.padEnd(24)} ${String(row.value)}\n`,
    );
} finally {
  await app.close();
}
