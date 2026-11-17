/**
 * D-160: renames the active season (e.g. «Сезон 3» → «Сезон 1» after the test seasons).
 *   node dist/ops/season-rename-cli.js --name "<new name>" --reason "<why>" [--confirm]
 * Without --confirm it only shows the change. Other processes pick it up within 10 s.
 */
import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '../config/env.js';
import { SeasonStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkerModule } from '../worker.module.js';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    reason: { type: 'string' },
    confirm: { type: 'boolean', default: false },
  },
});
const name = values.name?.trim();
if (!name || !values.reason) {
  process.stderr.write('usage: --name "<new name>" --reason "<why>" [--confirm]\n');
  process.exit(1);
}
const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(loadEnv()), {
  logger: ['error', 'warn'],
});
try {
  const prisma = app.get(PrismaService);
  const report = await prisma.transaction(async (tx) => {
    const active = await tx.season.findFirstOrThrow({ where: { status: SeasonStatus.active } });
    if (active.name === name || !values.confirm) return { from: active.name, to: name };
    await tx.season.update({ where: { id: active.id }, data: { name } });
    await tx.auditLog.create({
      data: {
        actorType: 'system',
        actorId: 'season-rename',
        action: 'season.rename',
        targetType: 'season',
        targetId: active.id,
        reason: values.reason,
        payload: { from: active.name, to: name },
      },
    });
    return { from: active.name, to: name };
  });
  process.stdout.write(`${JSON.stringify({ dryRun: !values.confirm, ...report }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await app.close();
}
