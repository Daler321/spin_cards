import { type Env, loadEnv } from '../../src/config/env.js';

export const TEST_BOT_TOKEN = '123456:TEST-bot-token-for-signatures';
export const TEST_INTERNAL_TOKEN = 'test-internal-token-test-internal-token-0001';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (run tests via make test)`);
  return value;
}

export function testEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    DATABASE_URL: requireEnv('TEST_DATABASE_URL'),
    REDIS_URL: requireEnv('TEST_REDIS_URL'),
    JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
    TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
    RATE_LIMIT_DEFAULT_PER_MIN: '100000',
    RATE_LIMIT_AUTH_PER_MIN: '100000',
    RATE_LIMIT_MUTATION_PER_MIN: '100000',
    RATE_LIMIT_INTERNAL_PER_MIN: '100000',
    INTERNAL_API_TOKEN: TEST_INTERNAL_TOKEN,
    ADMIN_SECRET_KEY: 'test-admin-secret-key-test-admin-secret-key',
    ...overrides,
  });
}
