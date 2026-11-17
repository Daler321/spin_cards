import { nodeProject } from '../../vitest.shared.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://spincards:spincards@postgres:5432/spincards';
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? databaseUrl.replace(/\/[^/?]+(\?|$)/, '/spincards_test$1');

export default nodeProject('api', {
  globalSetup: ['test/support/global-setup.ts'],
  env: {
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: testDatabaseUrl,
    TEST_REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://redis:6379/1',
  },
  testTimeout: 30_000,
  hookTimeout: 120_000,
});
