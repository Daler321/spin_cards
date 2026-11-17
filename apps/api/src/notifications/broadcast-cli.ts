/**
 * `make broadcast TEXT="…" SEGMENT=all|active|inactive DAYS=7`: queues a broadcast for the bot.
 * A stopgap until the admin panel (M8) calls BroadcastService itself; logged in audit_log as `cli`.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { BroadcastService } from './broadcast.service.js';

const env = loadEnv();
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
// PrismaService only adds the transaction helper on top of the client.
const service = new BroadcastService(
  Object.assign(prisma, {
    transaction: <T>(fn: Parameters<PrismaService['transaction']>[0]) =>
      prisma.$transaction(fn) as Promise<T>,
  }) as unknown as PrismaService,
);
try {
  const days = process.env.DAYS ? Number(process.env.DAYS) : undefined;
  const result = await service.create({
    text: process.env.TEXT ?? '',
    segment: (process.env.SEGMENT ?? 'all') as 'all' | 'active' | 'inactive',
    ...(days !== undefined && { days }),
    createdBy: 'cli',
  });
  process.stdout.write(`broadcast ${result.id} queued for ${String(result.recipients)} players\n`);
} finally {
  await prisma.$disconnect();
}
