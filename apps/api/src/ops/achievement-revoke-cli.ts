/**
 * D-151: takes back medals granted by mistake, with the money they paid since a moment.
 *   node dist/ops/achievement-revoke-cli.js --user <username> --ids a,b --since <iso> \
 *     --reason "<why>" [--confirm]
 * Without --confirm it only shows what would be taken back.
 */
import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '../config/env.js';
import { WorkerModule } from '../worker.module.js';
import { AchievementRevokeService } from './achievement-revoke.js';

const { values } = parseArgs({
  options: {
    user: { type: 'string' },
    ids: { type: 'string' },
    since: { type: 'string' },
    reason: { type: 'string' },
    confirm: { type: 'boolean', default: false },
  },
});
const since = new Date(values.since ?? '');
const ids = (values.ids ?? '').split(',').filter(Boolean);
if (!values.user || ids.length === 0 || Number.isNaN(since.getTime()) || !values.reason) {
  process.stderr.write(
    'usage: --user <username> --ids a,b --since <iso> --reason "<why>" [--confirm]\n',
  );
  process.exit(1);
}
const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(loadEnv()), {
  logger: ['error', 'warn'],
});
try {
  const report = await app.get(AchievementRevokeService).run({
    username: values.user,
    achievementIds: ids,
    since,
    reason: values.reason,
    confirm: values.confirm,
  });
  process.stdout.write(`${JSON.stringify({ dryRun: !values.confirm, ...report }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await app.close();
}
