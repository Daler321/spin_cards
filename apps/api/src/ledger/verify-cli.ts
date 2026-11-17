/** `pnpm --filter @spincards/api ledger:verify`: exit code 1 if any balance disagrees with the ledger. */
import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { findLedgerMismatches } from './verify.js';

const env = loadEnv();
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
try {
  const mismatches = await findLedgerMismatches(prisma);
  if (mismatches.length === 0) {
    process.stdout.write('ledger OK: every balance equals the sum of its ledger entries\n');
  } else {
    for (const m of mismatches) {
      process.stdout.write(
        `MISMATCH ${m.accountType} ${m.accountId}: balance ${m.balance} ledger ${m.ledgerSum}\n`,
      );
    }
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
