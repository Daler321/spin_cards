/**
 * Manual backup operations (D-117), run in the worker image:
 *   backup                 dump now (into BACKUP_DIR/manual)
 *   restore-check          restore the newest daily dump into a scratch DB and verify the ledger
 *   restore <file>         replace the database with a dump (api, worker and bot must be stopped)
 * Dev: `pnpm --filter @spincards/api ops <command>`; prod: `node dist/ops/cli.js <command>`.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '../config/env.js';
import { WorkerModule } from '../worker.module.js';
import { BackupService } from './backup.service.js';

const [command, file] = process.argv.slice(2);
const env = loadEnv();
const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), {
  logger: ['error', 'warn'],
});
const backups = app.get(BackupService);
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

try {
  switch (command) {
    case 'backup':
      print({ file: await backups.dump('manual') });
      break;
    case 'restore-check': {
      const status = await backups.restoreCheck();
      print(status);
      if (!status.ok) process.exitCode = 1;
      break;
    }
    case 'restore':
      if (!file) throw new Error('usage: restore <file>');
      print({ restored: file, safetyDump: await backups.restore(file) });
      break;
    default:
      throw new Error('usage: backup | restore-check | restore <file>');
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await app.close();
}
