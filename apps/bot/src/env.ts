import { NOTIFICATION_KINDS } from '@spincards/shared';
import { z } from 'zod';

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    BOT_HEALTH_PORT: z.coerce.number().int().positive().default(3002),
    BOT_TOKEN: z.string().trim().default(''),
    PUBLIC_URL: z.union([z.url(), z.literal('')]).default(''),
    /** The bot reaches the api inside the compose network only. */
    API_INTERNAL_URL: z.url().default('http://api:3000'),
    INTERNAL_API_TOKEN: z.string().default(''),
    /** polling (dev, no public address) or webhook (prod, PUBLIC_URL + /bot/webhook). */
    BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
    BOT_WEBHOOK_PORT: z.coerce.number().int().positive().default(3003),
    /** Telegram sends it in X-Telegram-Bot-Api-Secret-Token; required in webhook mode. */
    BOT_WEBHOOK_SECRET: z.string().default(''),
    /** Off: the bot answers commands but delivers no notifications (they wait in the outbox). */
    NOTIFY_ENABLED: z.stringbool().default(true),
    /** Comma-separated kinds to deliver, e.g. `broadcast`; empty delivers every kind. */
    NOTIFY_KINDS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.enum(NOTIFICATION_KINDS))),
    /** How often the bot asks the api for due notifications. */
    NOTIFY_POLL_MS: z.coerce.number().int().positive().default(2000),
  })
  .refine(
    (env) => env.BOT_MODE !== 'webhook' || /^[A-Za-z0-9_-]{16,256}$/.test(env.BOT_WEBHOOK_SECRET),
    {
      message: 'BOT_WEBHOOK_SECRET (16+ chars of A-Z a-z 0-9 _ -) is required in webhook mode',
      path: ['BOT_WEBHOOK_SECRET'],
    },
  );

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${issues.join('\n  ')}`);
  }
  return result.data;
}
