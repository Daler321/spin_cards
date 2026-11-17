import type { ClaimedNotification, NotificationResultRequest } from '@spincards/shared';
import { GrammyError, HttpError, InlineKeyboard } from 'grammy';
import type { TFunction } from 'i18next';

const LOCALE = 'ru-RU';

export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

export interface RenderedMessage {
  text: string;
  keyboard?: InlineKeyboard;
}

/** Message text for an outbox item; game messages come with a button that opens the Mini App. */
export function renderNotification(
  t: TFunction<'bot'>,
  item: ClaimedNotification,
  publicUrl: string,
): RenderedMessage {
  const keyboard = publicUrl.startsWith('https://')
    ? new InlineKeyboard().webApp(t('notify.openButton'), publicUrl)
    : undefined;
  if (item.kind === 'broadcast') {
    return { text: item.text ?? '', ...(keyboard && { keyboard }) };
  }
  const params = { ...item.params };
  if (typeof params.amount === 'number' && typeof params.currency === 'string')
    params.amount = formatMoney(params.amount, params.currency);
  return { text: t(`notify.${item.kind}`, params), ...(keyboard && { keyboard }) };
}

/** Maps a send failure to the outcome reported to the api. */
export function outcomeOf(error: unknown): NotificationResultRequest {
  if (error instanceof GrammyError) {
    // 403: blocked by the user or account deactivated; 400 "chat not found": the player never
    // started the bot (e.g. dev mock accounts). Both mark the player unreachable until /start.
    if (error.error_code === 403) return { outcome: 'blocked' };
    if (
      error.error_code === 400 &&
      /chat not found|user not found|PEER_ID_INVALID/i.test(error.description)
    )
      return { outcome: 'blocked' };
    return {
      outcome: 'failed',
      error: `${String(error.error_code)} ${error.description}`.slice(0, 300),
      ...(error.parameters.retry_after !== undefined && {
        retryAfterSec: error.parameters.retry_after,
      }),
    };
  }
  if (error instanceof HttpError) return { outcome: 'failed', error: 'network' };
  return { outcome: 'failed', error: 'unknown' };
}

/** Spaces sends so the bot stays under `perSecond` messages per second. */
export class RateLimiter {
  private next = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** How long to wait before the next send. */
  reserve(perSecond: number): number {
    const now = this.now();
    const at = Math.max(now, this.next);
    this.next = at + Math.ceil(1000 / perSecond);
    return at - now;
  }
}
