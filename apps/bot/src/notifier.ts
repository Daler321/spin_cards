import type { NotificationKind } from '@spincards/shared';
import type { Api } from 'grammy';
import type { TFunction } from 'i18next';
import type { Logger } from 'pino';
import type { InternalApi } from './api.js';
import { outcomeOf, RateLimiter, renderNotification } from './notify.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface NotifierOptions {
  api: InternalApi;
  telegram: Api;
  translator: (languageCode?: string) => TFunction<'bot'>;
  publicUrl: string;
  pollMs: number;
  logger: Logger;
  /** Deliver only these kinds (empty: all). */
  kinds?: readonly NotificationKind[];
}

/**
 * Delivery loop (TZ 14): claims due outbox rows from the api, sends them at the configured rate and
 * reports each outcome. Delivery rules (settings, quiet hours, caps) are the api's job; a crash
 * mid-batch only delays the leased rows until their lease ends.
 */
export class Notifier {
  private running = false;
  private readonly limiter = new RateLimiter();
  private loop: Promise<void> | null = null;
  /** Rate from the last claim (the api owns it); the first claim asks for a small batch. */
  private perSecond = 1;

  constructor(private readonly options: NotifierOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  /** One claim-and-send round; returns how many messages were claimed. */
  async tick(): Promise<number> {
    const { api, telegram, translator, publicUrl, logger } = this.options;
    const { items, perSecond } = await api.claim(
      Math.min(100, this.perSecond * 2),
      this.options.kinds,
    );
    this.perSecond = perSecond;
    for (const item of items) {
      await sleep(this.limiter.reserve(perSecond));
      const message = renderNotification(
        translator(item.languageCode ?? undefined),
        item,
        publicUrl,
      );
      let result;
      try {
        const { fromChatId, messageId } = item.params;
        if (item.kind === 'channel_post' && fromChatId !== undefined && messageId !== undefined)
          // D-145: the post itself, with its channel shown as the source.
          await telegram.forwardMessage(Number(item.telegramId), fromChatId, Number(messageId));
        else
          await telegram.sendMessage(Number(item.telegramId), message.text, {
            ...(message.keyboard && { reply_markup: message.keyboard }),
          });
        result = { outcome: 'sent' as const };
      } catch (error) {
        result = outcomeOf(error);
        logger.warn(
          { id: item.id, kind: item.kind, outcome: result.outcome },
          'notification not sent',
        );
      }
      await api.report(item.id, result).catch((error: unknown) => {
        logger.error({ err: error, id: item.id }, 'notification result not reported');
      });
    }
    return items.length;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        const claimed = await this.tick();
        if (claimed === 0) await sleep(this.options.pollMs);
      } catch (error) {
        this.options.logger.error({ err: error }, 'notification round failed');
        await sleep(this.options.pollMs * 5);
      }
    }
  }
}
