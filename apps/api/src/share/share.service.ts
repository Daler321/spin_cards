import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type AdminShareSettings, ErrorCode, type ShareImageResponse } from '@spincards/shared';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { ENV, type Env } from '../config/env.js';
import { TelegramApiService } from '../payments/telegram-api.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';

const TTL_SEC = 60 * 60;
const MAX_BYTES = 700 * 1024;
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
export const SHARE_SETTINGS_KEY = 'share';
const CAPTION_MAX = 1024;

export const ShareSettingsSchema = z.object({
  adText: z.string().trim().max(200),
  /** Optional link the channel line points to (a t.me link). */
  adUrl: z
    .union([
      z.url().refine((u) => u.startsWith('https://t.me/'), 'must be a t.me link'),
      z.literal(''),
    ])
    .default(''),
});

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Card sharing (D-114). The Mini App renders the card to a JPEG and uploads it; the image lives in
 * Redis for an hour under an unguessable token and is served publicly (Telegram and the save dialog
 * fetch it by URL). Sharing stores a prepared photo message for the player, with the admin's quiet
 * channel line appended, and the Mini App opens Telegram's chat picker with it.
 */
@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramApiService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async upload(userId: string, cardId: string, base64: string): Promise<ShareImageResponse> {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: { ownerId: true },
    });
    if (card?.ownerId !== userId)
      throw new AppError(ErrorCode.CARD_NOT_FOUND, HttpStatus.NOT_FOUND);
    const image = Buffer.from(base64, 'base64');
    if (image.length === 0 || image.length > MAX_BYTES || !image.subarray(0, 3).equals(JPEG_MAGIC))
      throw new AppError(ErrorCode.VALIDATION_FAILED);
    const token = randomBytes(24).toString('base64url');
    await this.redis
      .multi()
      .set(`share:img:${token}`, image, 'EX', TTL_SEC)
      .set(`share:owner:${token}`, userId, 'EX', TTL_SEC)
      .exec();
    return { token, url: this.urlOf(token) };
  }

  async image(token: string): Promise<Buffer | null> {
    return this.redis.getBuffer(`share:img:${token}`);
  }

  /** HTML caption: the text, the referral link hidden under its words, then the channel line. */
  async prepare(
    userId: string,
    token: string,
    message: { text: string; link?: { url: string; text: string } },
  ): Promise<string> {
    const owner = await this.redis.get(`share:owner:${token}`);
    if (owner !== userId) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { telegramId: true },
    });
    const { adText, adUrl } = await this.settings();
    let caption = escapeHtml(message.text);
    if (message.link)
      caption += `\n<a href="${escapeHtml(message.link.url)}">${escapeHtml(message.link.text)}</a>`;
    if (adText)
      caption += adUrl
        ? `\n\n<a href="${escapeHtml(adUrl)}">${escapeHtml(adText)}</a>`
        : `\n\n${escapeHtml(adText)}`;
    return this.telegram.savePreparedPhoto(Number(user.telegramId), {
      id: token.slice(0, 32),
      url: this.urlOf(token),
      caption: caption.slice(0, CAPTION_MAX),
    });
  }

  async settings(): Promise<AdminShareSettings> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: SHARE_SETTINGS_KEY } });
    const parsed = ShareSettingsSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : { adText: '', adUrl: '' };
  }

  async saveSettings(settings: AdminShareSettings, updatedBy: string): Promise<void> {
    const value = ShareSettingsSchema.parse(settings);
    await this.prisma.appSetting.upsert({
      where: { key: SHARE_SETTINGS_KEY },
      create: { key: SHARE_SETTINGS_KEY, value, updatedBy },
      update: { value, updatedBy },
    });
  }

  private urlOf(token: string): string {
    const base = this.env.PUBLIC_URL || 'http://localhost:8080';
    return `${base.replace(/\/$/, '')}/api/v1/share/images/${token}.jpg`;
  }
}
