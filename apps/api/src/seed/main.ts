/** `pnpm seed` (dev) / `pnpm seed:prod`: runs on every api start, safe to repeat. */
import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { seed } from './seed.js';

const env = loadEnv();
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
try {
  const summary = await seed(prisma, env);
  process.stdout.write(`seed: ${JSON.stringify(summary)}\n`);
} finally {
  await prisma.$disconnect();
}
