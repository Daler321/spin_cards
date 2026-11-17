import { describe, expect, it } from 'vitest';
import { validateInitData } from '../src/auth/telegram-init-data.js';
import { signInitData } from './support/app.js';
import { TEST_BOT_TOKEN } from './support/env.js';

const now = new Date('2026-10-12T12:00:00Z');
const DAY = 86_400;

describe('validateInitData', () => {
  it('accepts data signed with the bot token', () => {
    const raw = signInitData({
      telegramId: 42,
      firstName: 'Аня',
      startParam: 'ref_ABCDEFGH',
      authDate: now,
    });
    const result = validateInitData(raw, TEST_BOT_TOKEN, DAY, now);
    expect(result).toEqual({
      ok: true,
      data: {
        user: { id: 42, first_name: 'Аня', language_code: 'ru' },
        authDate: now,
        startParam: 'ref_ABCDEFGH',
      },
    });
  });

  it('rejects tampered fields', () => {
    const raw = signInitData({ telegramId: 42, authDate: now }).replace('42', '43');
    expect(validateInitData(raw, TEST_BOT_TOKEN, DAY, now)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a signature made with another bot token', () => {
    const raw = signInitData({ authDate: now, botToken: '999:other' });
    expect(validateInitData(raw, TEST_BOT_TOKEN, DAY, now)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects data older than the max age', () => {
    const raw = signInitData({ authDate: new Date(now.getTime() - (DAY + 1) * 1000) });
    expect(validateInitData(raw, TEST_BOT_TOKEN, DAY, now)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects garbage, a missing hash and an unset bot token', () => {
    expect(validateInitData('garbage', TEST_BOT_TOKEN, DAY, now).ok).toBe(false);
    expect(validateInitData('user=%7B%7D&auth_date=1', TEST_BOT_TOKEN, DAY, now).ok).toBe(false);
    expect(validateInitData(signInitData({ authDate: now }), '', DAY, now).ok).toBe(false);
  });
});
