import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(base);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3000);
    expect(env.DEV_AUTH_BYPASS).toBe(false);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('parses CORS origins list', () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: 'https://a.example, https://b.example' });
    expect(env.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });

  it('allows DEV_AUTH_BYPASS in development', () => {
    expect(loadEnv({ ...base, DEV_AUTH_BYPASS: 'true' }).DEV_AUTH_BYPASS).toBe(true);
  });

  it.each(['production', 'test'])('refuses DEV_AUTH_BYPASS with NODE_ENV=%s', (nodeEnv) => {
    expect(() => loadEnv({ ...base, NODE_ENV: nodeEnv, DEV_AUTH_BYPASS: 'true' })).toThrow(
      /DEV_AUTH_BYPASS/,
    );
  });

  it('requires a long JWT secret', () => {
    expect(() => loadEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('requires the bot token and the internal token in production', () => {
    const internal = {
      INTERNAL_API_TOKEN: 'x'.repeat(32),
      ADMIN_SECRET_KEY: 'k'.repeat(32),
      PUBLIC_URL: 'https://game.example',
      CORS_ORIGINS: 'https://game.example',
    };
    expect(() => loadEnv({ ...base, ...internal, NODE_ENV: 'production' })).toThrow(
      /TELEGRAM_BOT_TOKEN/,
    );
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', TELEGRAM_BOT_TOKEN: '1:x' })).toThrow(
      /INTERNAL_API_TOKEN/,
    );
    expect(
      loadEnv({ ...base, ...internal, NODE_ENV: 'production', TELEGRAM_BOT_TOKEN: '1:x' }).NODE_ENV,
    ).toBe('production');
  });

  it('refuses development leftovers in production', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      TELEGRAM_BOT_TOKEN: '1:x',
      INTERNAL_API_TOKEN: 'x'.repeat(32),
      ADMIN_SECRET_KEY: 'k'.repeat(32),
      PUBLIC_URL: 'https://game.example',
      CORS_ORIGINS: 'https://game.example',
    };
    expect(loadEnv(prod).NODE_ENV).toBe('production');
    expect(() => loadEnv({ ...prod, PUBLIC_URL: 'http://game.example' })).toThrow(/PUBLIC_URL/);
    expect(() => loadEnv({ ...prod, CORS_ORIGINS: '' })).toThrow(/CORS_ORIGINS/);
    expect(() => loadEnv({ ...prod, CORS_ORIGINS: 'http://localhost:8080' })).toThrow(
      /CORS_ORIGINS/,
    );
    expect(() => loadEnv({ ...prod, JWT_SECRET: `${'x'.repeat(32)}__generate__` })).toThrow(
      /JWT_SECRET/,
    );
    expect(() =>
      loadEnv({ ...prod, DATABASE_URL: 'postgresql://spincards:spincards@postgres:5432/db' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('does not echo secret values on error', () => {
    const secret = 'not-a-url-s3cr3t';
    expect(() => loadEnv({ ...base, DATABASE_URL: secret })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...base, DATABASE_URL: secret })).not.toThrow(new RegExp(secret));
  });
});
