/**
 * D-149: fresh start of every player in a new season (leaving the alpha).
 *   node dist/ops/season-launch-cli.js --name Бета --starts 2026-10-16T19:00:00Z \
 *     --ends 2026-10-23T19:00:00Z [--rename-old Альфа] [--reset-referrals] [--confirm]
 * Without --confirm it only counts what would be reset. Run with the game in maintenance mode.
 */
import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '../config/env.js';
import { WorkerModule } from '../worker.module.js';
import { SeasonLaunchService } from './season-launch.js';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    starts: { type: 'string' },
    ends: { type: 'string' },
    'rename-old': { type: 'string' },
    'reset-referrals': { type: 'boolean', default: false },
    confirm: { type: 'boolean', default: false },
  },
});

const startsAt = new Date(values.starts ?? '');
const endsAt = new Date(values.ends ?? '');
if (
  !values.name ||
  Number.isNaN(startsAt.getTime()) ||
  Number.isNaN(endsAt.getTime()) ||
  endsAt <= startsAt
) {
  process.stderr.write(
    'usage: --name <name> --starts <iso> --ends <iso> [--rename-old <name>] [--reset-referrals] [--confirm]\n',
  );
  process.exit(1);
}

const env = loadEnv();
const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), {
  logger: ['error', 'warn'],
});
try {
  const report = await app.get(SeasonLaunchService).run({
    name: values.name,
    startsAt,
    endsAt,
    renameOldTo: values['rename-old'],
    resetReferrals: values['reset-referrals'],
    confirm: values.confirm,
  });
  process.stdout.write(`${JSON.stringify({ dryRun: !values.confirm, ...report }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await app.close();
}
