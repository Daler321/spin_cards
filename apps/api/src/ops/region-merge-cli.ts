/**
 * D-156: moves players of other regions to rubles, with the season start money for who has not
 * had it (a one-off fix; dollars stay available).
 *   node dist/ops/region-merge-cli.js --reason "<why>" [--confirm]
 * Without --confirm it only counts.
 */
import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '../config/env.js';
import { WorkerModule } from '../worker.module.js';
import { RegionMergeService } from './region-merge.js';

const { values } = parseArgs({
  options: {
    reason: { type: 'string' },
    confirm: { type: 'boolean', default: false },
  },
});
if (!values.reason) {
  process.stderr.write('usage: --reason "<why>" [--confirm]\n');
  process.exit(1);
}
const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(loadEnv()), {
  logger: ['error', 'warn'],
});
try {
  const report = await app.get(RegionMergeService).run({
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
