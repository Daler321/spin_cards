import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const TelegramUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
  photo_url: z.url().optional(),
});

export type TelegramUser = z.infer<typeof TelegramUserSchema>;

export interface TelegramInitData {
  user: TelegramUser;
  authDate: Date;
  startParam: string | null;
}

export type InitDataResult =
  { ok: true; data: TelegramInitData } | { ok: false; reason: 'invalid' | 'expired' };

/**
 * Validates Mini App initData (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 * secret = HMAC_SHA256(key "WebAppData", bot token); hash = HMAC_SHA256(secret, data-check-string).
 */
export function validateInitData(
  raw: string,
  botToken: string,
  maxAgeSec: number,
  now: Date,
): InitDataResult {
  if (!botToken) return { ok: false, reason: 'invalid' };
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: 'invalid' };

  const expected = createHmac('sha256', telegramSecret(botToken))
    .update(dataCheckString(params))
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return { ok: false, reason: 'invalid' };

  const authDateSec = Number(params.get('auth_date'));
  if (!Number.isInteger(authDateSec) || authDateSec <= 0) return { ok: false, reason: 'invalid' };
  const ageSec = now.getTime() / 1000 - authDateSec;
  if (ageSec > maxAgeSec) return { ok: false, reason: 'expired' };

  const user = TelegramUserSchema.safeParse(safeJson(params.get('user')));
  if (!user.success) return { ok: false, reason: 'invalid' };

  return {
    ok: true,
    data: {
      user: user.data,
      authDate: new Date(authDateSec * 1000),
      startParam: params.get('start_param'),
    },
  };
}

export function telegramSecret(botToken: string): Buffer {
  return createHmac('sha256', 'WebAppData').update(botToken).digest();
}

export function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function safeJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
