import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AdminChannelCheck,
  AdminSubscriptionSettings,
  SubscriptionStatus,
} from '@spincards/shared';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { TelegramApiService } from '../payments/telegram-api.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';

export const SUBSCRIPTION_KEY = 'subscription';
const SETTINGS_CACHE_MS = 10_000;
const JOINED_TTL_SEC = 10 * 60;
const NOT_JOINED_TTL_SEC = 30;
const MEMBER_STATUSES = new Set(['creator', 'administrator', 'member']);

export const SubscriptionSettingsSchema = z.object({
  enabled: z.boolean(),
  channels: z
    .array(
      z.object({
        chatId: z
          .string()
          .trim()
          .regex(/^(@[A-Za-z0-9_]{4,32}|-100\d{5,15})$/),
        title: z.string().trim().min(1).max(64),
        url: z.url().refine((u) => u.startsWith('https://t.me/'), 'must be a t.me link'),
      }),
    )
    .max(5),
});

/**
 * Required channel subscription (D-110): while enabled, a player must be a member of every
 * listed channel to play. Membership comes from Telegram's getChatMember (the bot must be an admin
 * of the channel) and is cached briefly; a Telegram error (bot not admin, wrong channel) does not
 * lock players out: it is logged and the channel counts as joined.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);
  private cached: { value: AdminSubscriptionSettings; until: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramApiService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async settings(): Promise<AdminSubscriptionSettings> {
    const now = performance.now();
    if (this.cached && this.cached.until > now) return this.cached.value;
    const row = await this.prisma.appSetting.findUnique({ where: { key: SUBSCRIPTION_KEY } });
    const parsed = SubscriptionSettingsSchema.safeParse(row?.value);
    const value = parsed.success ? parsed.data : { enabled: false, channels: [] };
    this.cached = { value, until: now + SETTINGS_CACHE_MS };
    return value;
  }

  async save(settings: AdminSubscriptionSettings, updatedBy: string): Promise<void> {
    const value = SubscriptionSettingsSchema.parse(settings);
    await this.prisma.appSetting.upsert({
      where: { key: SUBSCRIPTION_KEY },
      create: { key: SUBSCRIPTION_KEY, value, updatedBy },
      update: { value, updatedBy },
    });
    this.cached = null;
  }

  async status(telegramId: bigint, fresh = false): Promise<SubscriptionStatus> {
    const settings = await this.settings();
    if (!settings.enabled || settings.channels.length === 0)
      return { required: false, ok: true, channels: [] };
    const channels = await Promise.all(
      settings.channels.map(async (channel) => ({
        title: channel.title,
        url: channel.url,
        joined: await this.joined(channel.chatId, telegramId, fresh),
      })),
    );
    return { required: true, ok: channels.every((c) => c.joined), channels };
  }

  /**
   * The channel quest (D-157): asks Telegram now, and a failed check counts as not joined, so a
   * reward is never paid on a guess (the required gate above lets players in instead).
   */
  async joinedAll(telegramId: bigint): Promise<boolean> {
    const { channels } = await this.settings();
    if (channels.length === 0) return false;
    const joined = await Promise.all(
      channels.map((c) => this.joined(c.chatId, telegramId, true, true)),
    );
    return joined.every(Boolean);
  }

  /** Whether the bot can read members of each channel (shown in the admin panel). */
  async checkBot(settings: AdminSubscriptionSettings): Promise<AdminChannelCheck[]> {
    const me = await this.telegram.getMe();
    return Promise.all(
      settings.channels.map(async (channel) => {
        try {
          const status = await this.telegram.getChatMemberStatus(channel.chatId, me.id);
          return {
            chatId: channel.chatId,
            ok: status === 'administrator' || status === 'creator',
            error: status === 'administrator' || status === 'creator' ? null : `bot is ${status}`,
          };
        } catch (error) {
          return { chatId: channel.chatId, ok: false, error: (error as Error).message };
        }
      }),
    );
  }

  private async joined(
    chatId: string,
    telegramId: bigint,
    fresh: boolean,
    strict = false,
  ): Promise<boolean> {
    const key = `sub:${chatId}:${telegramId.toString()}`;
    if (!fresh) {
      const cached = await this.redis.get(key).catch(() => null);
      if (cached !== null) return cached === '1';
    }
    let joined: boolean;
    try {
      joined = MEMBER_STATUSES.has(
        await this.telegram.getChatMemberStatus(chatId, Number(telegramId)),
      );
    } catch (error) {
      if (strict) {
        this.logger.error({ err: error, chatId }, 'channel quest check failed');
        return false;
      }
      // Misconfiguration must not lock everyone out.
      this.logger.error({ err: error, chatId }, 'subscription check failed, letting the player in');
      return true;
    }
    await this.redis
      .set(key, joined ? '1' : '0', 'EX', joined ? JOINED_TTL_SEC : NOT_JOINED_TTL_SEC)
      .catch(() => undefined);
    return joined;
  }
}
