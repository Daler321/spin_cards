import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { testEnv } from './env.js';

const API_DIR = new URL('../..', import.meta.url).pathname;

/**
 * Creates the test database if needed, resets it to the latest migrations and seeds it.
 * Migrate and seed run as child processes, exactly as on api start.
 */
export default async function setup(): Promise<void> {
  const env = testEnv();
  const database = new URL(env.DATABASE_URL).pathname.slice(1);

  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      database,
    ]);
    if (rowCount === 0) await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }

  const childEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: env.DATABASE_URL,
    REDIS_URL: env.REDIS_URL,
    JWT_SECRET: env.JWT_SECRET,
    TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
  };
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'reset', '--force'], {
    cwd: API_DIR,
    env: childEnv,
    stdio: 'pipe',
  });
  execFileSync('pnpm', ['run', '--silent', 'seed'], { cwd: API_DIR, env: childEnv, stdio: 'pipe' });

  // Test fixture: the scenarios count on a 5 000 ₽ starting wallet (a batch of four 1 000 ₽ spins
  // fits, a fifth does not), whatever the production default is.
  const db = new pg.Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(
      `UPDATE game_config_versions SET payload = jsonb_set(payload, '{startingBalance}', $1::jsonb)
       WHERE status = 'active'`,
      [JSON.stringify({ RUB: TEST_STARTING_BALANCE })],
    );
    // No achievements by default: their rewards would move the exact balances other scenarios check.
    // Achievement tests switch them on per app instance (patchConfig).
    await db.query(
      `UPDATE game_config_versions SET payload = jsonb_set(payload, '{achievements}', '[]'::jsonb)
       WHERE status = 'active'`,
    );
    // Analytics tests compute fixed past days: no statistics start (D-152).
    await db.query(
      `UPDATE game_config_versions SET payload = jsonb_set(payload, '{analytics,since}', 'null'::jsonb)
       WHERE status = 'active'`,
    );
    // The scenarios keep several cards: a 4-slot starter holder, whatever the default is (D-150).
    await db.query(
      `UPDATE game_config_versions SET payload = jsonb_set(payload, '{holders,0,slots}', $1::jsonb)
       WHERE status = 'active' AND payload #>> '{holders,0,id}' = 'basic'`,
      [JSON.stringify(TEST_STARTER_SLOTS)],
    );
  } finally {
    await db.end();
  }
}

export const TEST_STARTING_BALANCE = 500_000;
export const TEST_STARTER_SLOTS = 4;
