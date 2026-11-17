import { Inject, Injectable, Logger } from '@nestjs/common';
import { type AdminOpsSettings, type AdminOpsTestResult, resources } from '@spincards/shared';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { TelegramApiService } from '../payments/telegram-api.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';

const SETTINGS_KEY = 'ops';
/** The same alert at most once per this many seconds. */
const DEFAULT_TTL_SEC = 30 * 60;

export const OpsSettingsSchema = z.object({
  alertChatIds: z
    .array(z.string().regex(/^-?\d{1,20}$/, 'a numeric Telegram id'))
    .max(10)
    .transform((ids) => [...new Set(ids)]),
});

export type OpsAlertKind = keyof (typeof resources)['ru']['admin']['opsAlert'];

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Alert text from the admin locale (`opsAlert.<kind>`), `{name}` placeholders filled in. */
export function alertText(
  kind: OpsAlertKind,
  params: Record<string, string | number> = {},
): string {
  const template: string = resources.ru.admin.opsAlert[kind];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? escapeHtml(String(params[name])) : match,
  );
}

/**
 * Operational alerts to the owner (D-117): sent straight through the Bot API, so they arrive even
 * when the bot service is down. Recipients are set in the admin panel; repeats are throttled.
 */
@Injectable()
export class OpsAlertsService {
  private readonly logger = new Logger(OpsAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramApiService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async settings(): Promise<AdminOpsSettings> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
    const parsed = OpsSettingsSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : { alertChatIds: [] };
  }

  async saveSettings(settings: AdminOpsSettings, updatedBy: string): Promise<void> {
    const value = OpsSettingsSchema.parse(settings);
    await this.prisma.appSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value, updatedBy },
      update: { value, updatedBy },
    });
  }

  /**
   * Sends the alert unless the same `key` fired within `ttlSec`; returns whether it was sent.
   * Never throws: a failing alert must not break the job that raised it.
   */
  async send(
    key: string,
    kind: OpsAlertKind,
    params: Record<string, string | number> = {},
    ttlSec = DEFAULT_TTL_SEC,
  ): Promise<boolean> {
    try {
      const fresh = await this.redis.set(`ops:alert:${key}`, '1', 'EX', ttlSec, 'NX');
      if (fresh !== 'OK') return false;
      this.logger.warn({ key, kind, params }, 'ops alert');
      const { alertChatIds } = await this.settings();
      await this.deliver(alertChatIds, alertText(kind, params));
      return true;
    } catch (error) {
      this.logger.error({ err: error, key }, 'ops alert failed');
      return false;
    }
  }

  /** Lets the next alert with this key through (e.g. a service came back). */
  async reset(key: string): Promise<void> {
    await this.redis.del(`ops:alert:${key}`);
  }

  /** A test message to every recipient, with the result per chat. */
  async test(chatIds: string[]): Promise<AdminOpsTestResult[]> {
    const text = alertText('test');
    return Promise.all(
      chatIds.map(async (chatId) => {
        try {
          await this.telegram.sendMessage(chatId, text);
          return { chatId, ok: true, error: null };
        } catch (error) {
          return { chatId, ok: false, error: (error as Error).message };
        }
      }),
    );
  }

  private async deliver(chatIds: string[], text: string): Promise<void> {
    for (const chatId of chatIds) {
      await this.telegram.sendMessage(chatId, text).catch((error: unknown) => {
        this.logger.error({ err: error, chatId }, 'ops alert not delivered');
      });
    }
  }
}
