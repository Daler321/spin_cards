import { NOTIFICATION_KINDS } from '@spincards/shared';
import { GrammyError } from 'grammy';
import { describe, expect, it } from 'vitest';
import { createI18n } from '../src/i18n.js';
import { formatMoney, outcomeOf, RateLimiter, renderNotification } from '../src/notify.js';

const translator = await createI18n();
const t = translator('ru');
const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');
const item = (kind: (typeof NOTIFICATION_KINDS)[number], params = {}, text?: string) => ({
  id: 'n1',
  kind,
  telegramId: '42',
  languageCode: 'ru',
  params,
  ...(text && { text }),
});

describe('renderNotification', () => {
  it('has a text for every game notification', () => {
    for (const kind of NOTIFICATION_KINDS.filter((k) => k !== 'broadcast')) {
      expect(t(`notify.${kind}`, { last4: '1234', hours: 2, amount: '1 ₽' })).not.toContain(
        'notify.',
      );
    }
  });

  it('pluralises hours, formats rewards and adds the Mini App button', () => {
    const expiring = renderNotification(
      t,
      item('card_expiring', { last4: '4242', hours: 5 }),
      'https://game.example',
    );
    expect(expiring.text).toContain('•••• 4242 сгорит примерно через 5 часов');
    expect(expiring.keyboard?.inline_keyboard).toEqual([
      [{ text: 'Открыть игру', web_app: { url: 'https://game.example' } }],
    ]);
    expect(
      renderNotification(t, item('card_expiring', { last4: '1', hours: 1 }), '').text,
    ).toContain('через 1 час');
    const reward = renderNotification(
      t,
      item('referral_reward', { share: 5, days: 30 }),
      'http://localhost',
    );
    expect(nbsp(reward.text)).toContain('30 дней вы получаете 5% от его прокрутов');
    expect(reward.keyboard).toBeUndefined();
  });

  it('sends broadcasts as written', () => {
    expect(renderNotification(t, item('broadcast', {}, 'Сезон «Осень»!'), '').text).toBe(
      'Сезон «Осень»!',
    );
  });

  it('formats money without float noise', () => {
    expect(nbsp(formatMoney(150_050, 'RUB'))).toBe('1 500,50 ₽');
    expect(nbsp(formatMoney(1000, 'USD'))).toBe('10 $');
  });
});

describe('outcomeOf', () => {
  const error = (code: number, description: string, parameters = {}) =>
    new GrammyError(
      'call failed',
      { ok: false, error_code: code, description, parameters },
      'sendMessage',
      {},
    );

  it('treats 403 as a block and keeps Telegram retry_after', () => {
    expect(outcomeOf(error(403, 'Forbidden: bot was blocked by the user'))).toEqual({
      outcome: 'blocked',
    });
    expect(outcomeOf(error(429, 'Too Many Requests', { retry_after: 7 }))).toEqual({
      outcome: 'failed',
      error: '429 Too Many Requests',
      retryAfterSec: 7,
    });
    expect(outcomeOf(error(400, 'Bad Request: chat not found'))).toEqual({ outcome: 'blocked' });
    expect(outcomeOf(error(400, 'Bad Request: message text is empty'))).toMatchObject({
      outcome: 'failed',
    });
    expect(outcomeOf(new Error('boom'))).toEqual({ outcome: 'failed', error: 'unknown' });
  });
});

describe('RateLimiter', () => {
  it('spaces sends to the allowed rate', () => {
    let now = 1000;
    const limiter = new RateLimiter(() => now);
    expect(limiter.reserve(25)).toBe(0);
    expect(limiter.reserve(25)).toBe(40);
    expect(limiter.reserve(25)).toBe(80);
    now += 500;
    expect(limiter.reserve(25)).toBe(0);
  });
});
