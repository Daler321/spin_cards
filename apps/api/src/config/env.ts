import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const positiveInt = z.coerce.number().int().positive();

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: positiveInt.default(3000),
    /** API processes sharing the port (D-118): a number, or `auto` for one per CPU core. */
    API_PROCESSES: z.union([z.literal('auto'), positiveInt.max(64)]).default(1),
    /** Load shedding per process: requests in flight and event-loop delay (ms) limits. */
    OVERLOAD_MAX_IN_FLIGHT: positiveInt.default(256),
    OVERLOAD_MAX_LAG_MS: positiveInt.default(300),
    WORKER_HEALTH_PORT: positiveInt.default(3001),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    /** Postgres connections per process (api and worker each have their own pool). */
    DATABASE_POOL_SIZE: positiveInt.max(200).default(20),
    CORS_ORIGINS: csv,
    DEV_AUTH_BYPASS: z.stringbool().default(false),

    /** Bot token: verifies Telegram initData signatures. */
    TELEGRAM_BOT_TOKEN: z.string().trim().default(''),
    /** initData older than this is rejected (TZ: at most one day). */
    INIT_DATA_MAX_AGE_SEC: positiveInt.max(86_400).default(86_400),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SEC: positiveInt.default(3600),
    REFRESH_TOKEN_TTL_DAYS: positiveInt.default(30),

    /** Requests per minute: per IP on public routes, per user on authenticated ones. */
    RATE_LIMIT_DEFAULT_PER_MIN: positiveInt.default(300),
    RATE_LIMIT_AUTH_PER_MIN: positiveInt.default(60),
    RATE_LIMIT_MUTATION_PER_MIN: positiveInt.default(180),
    /** Internal bot routes: one budget for the bot process (notifications are bursty). */
    RATE_LIMIT_INTERNAL_PER_MIN: positiveInt.default(6000),

    /** Shared secret of the internal bot routes (header x-internal-token). Empty disables them. */
    INTERNAL_API_TOKEN: z.union([z.string().min(32), z.literal('')]).default(''),
    /** Prefix of leaderboard keys in Redis (tests isolate themselves with it). */
    LEADERBOARD_KEY_PREFIX: z.string().default('lb'),
    /** HTTPS address of the Mini App: shared card images are served under it (Telegram fetches them). */
    PUBLIC_URL: z.union([z.url(), z.literal('')]).default(''),
    /** Telegram Bot API base URL (overridden in tests). */
    TELEGRAM_API_URL: z.url().default('https://api.telegram.org'),

    /** Optional: seeds the owner admin account (TOTP is set up on the first login). */
    ADMIN_OWNER_LOGIN: z.string().trim().default(''),
    ADMIN_OWNER_PASSWORD: z.string().default(''),
    /** Encrypts admin TOTP secrets at rest. `make env` generates it. */
    ADMIN_SECRET_KEY: z
      .union([z.string().min(32, 'ADMIN_SECRET_KEY must be at least 32 characters'), z.literal('')])
      .default(''),
    /** Admin session lifetime (hours) and idle timeout (minutes). */
    // D-120: a week, logged out after a day without activity.
    ADMIN_SESSION_HOURS: positiveInt.max(30 * 24).default(7 * 24),
    ADMIN_SESSION_IDLE_MIN: positiveInt.max(7 * 24 * 60).default(24 * 60),

    /** Folder for database dumps (worker); empty disables scheduled backups. */
    BACKUP_DIR: z.string().trim().default(''),
    BACKUP_KEEP_DAILY: positiveInt.default(7),
    BACKUP_KEEP_WEEKLY: positiveInt.default(4),
    /** Cron (UTC) of the daily dump and of the weekly restore check. */
    BACKUP_CRON: z.string().default('0 3 * * *'),
    RESTORE_CHECK_CRON: z.string().default('30 3 * * 0'),
    /** name=url health endpoints the worker watches, e.g. `api=http://api:3000/health`. */
    OPS_HEALTH_URLS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => {
            const at = item.indexOf('=');
            return { name: item.slice(0, at), url: item.slice(at + 1) };
          }),
      )
      .pipe(z.array(z.object({ name: z.string().min(1), url: z.url() }))),
    /** Unexpected 5xx responses within 5 minutes that raise an alert. */
    OPS_5XX_ALERT: positiveInt.default(20),
    /** Free disk share (of the backup folder's disk) below which an alert fires. */
    OPS_DISK_FREE_ALERT_PCT: positiveInt.max(99).default(10),
  })
  .refine((env) => !(env.DEV_AUTH_BYPASS && env.NODE_ENV !== 'development'), {
    message: 'DEV_AUTH_BYPASS is allowed only with NODE_ENV=development',
    path: ['DEV_AUTH_BYPASS'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.ADMIN_SECRET_KEY !== '', {
    message: 'ADMIN_SECRET_KEY is required in production',
    path: ['ADMIN_SECRET_KEY'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.INTERNAL_API_TOKEN !== '', {
    message: 'INTERNAL_API_TOKEN is required in production',
    path: ['INTERNAL_API_TOKEN'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.TELEGRAM_BOT_TOKEN !== '', {
    message: 'TELEGRAM_BOT_TOKEN is required in production',
    path: ['TELEGRAM_BOT_TOKEN'],
  })
  // Production refuses development leftovers rather than running with them.
  .refine((env) => env.NODE_ENV !== 'production' || env.PUBLIC_URL.startsWith('https://'), {
    message: 'PUBLIC_URL must be an https:// address in production',
    path: ['PUBLIC_URL'],
  })
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      (env.CORS_ORIGINS.length > 0 && env.CORS_ORIGINS.every((o) => o.startsWith('https://'))),
    {
      message: 'CORS_ORIGINS must list the https:// origins in production',
      path: ['CORS_ORIGINS'],
    },
  )
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      ![env.JWT_SECRET, env.ADMIN_SECRET_KEY, env.INTERNAL_API_TOKEN].some((s) =>
        s.includes('__generate__'),
      ),
    { message: 'secrets still hold the __generate__ placeholder', path: ['JWT_SECRET'] },
  )
  .refine(
    (env) => env.NODE_ENV !== 'production' || URL.parse(env.DATABASE_URL)?.password !== 'spincards',
    {
      message: 'the default Postgres password is not allowed in production',
      path: ['DATABASE_URL'],
    },
  );

export type Env = z.infer<typeof EnvSchema>;

/** Parses env or throws with a list of invalid variable names (values are never echoed). */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${issues.join('\n  ')}`);
  }
  return result.data;
}

export const ENV = Symbol('ENV');
