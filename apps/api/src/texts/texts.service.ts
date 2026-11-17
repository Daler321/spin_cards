import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AdminTextsResponse,
  type BotOptions,
  EDITABLE_TEXT_KEYS,
  BOT_SHARED_TEXTS,
  EDITABLE_TEXTS,
  type EditableTextKey,
  ErrorCode,
  overrideProblem,
  resources,
  type StartLinkButton,
  type TextSettings,
} from '@spincards/shared';
import { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

const KEY = 'texts';

const SettingsSchema = z.object({
  overrides: z.record(z.string(), z.string()).default({}),
  startLink: z
    .object({ text: z.string().trim().min(1).max(64), url: z.url() })
    .nullable()
    .default(null),
  bot: z
    .object({
      supportChatId: z
        .string()
        .regex(/^-?\d+$/)
        .nullable()
        .default(null),
      channelPosts: z.boolean().default(false),
    })
    .default({ supportChatId: null, channelPosts: false }),
});

const NO_BOT_OPTIONS: BotOptions = { supportChatId: null, channelPosts: false };

/** The i18n default of `ns:path` (ru). */
export function defaultText(key: EditableTextKey): string {
  const [ns, path] = key.split(':') as [keyof (typeof resources)['ru'], string];
  let node: unknown = resources.ru[ns];
  for (const part of path.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  return typeof node === 'string' ? node : '';
}

/** Owner-edited texts of the Mini App and the bot (D-134). */
@Injectable()
export class TextsService {
  constructor(private readonly prisma: PrismaService) {}

  async settings(): Promise<TextSettings> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: KEY } });
    const parsed = SettingsSchema.safeParse(row?.value ?? {});
    const value = parsed.success
      ? parsed.data
      : { overrides: {}, startLink: null, bot: NO_BOT_OPTIONS };
    // Keys no longer editable (or no longer existing) are ignored.
    const overrides: TextSettings['overrides'] = {};
    for (const key of EDITABLE_TEXT_KEYS) {
      const text = value.overrides[key];
      if (text !== undefined) overrides[key] = text;
    }
    return { overrides, startLink: value.startLink, bot: value.bot };
  }

  async adminView(): Promise<AdminTextsResponse> {
    const { overrides, startLink, bot } = await this.settings();
    const item = (group: 'miniApp' | 'bot') => (key: EditableTextKey) => ({
      key,
      group,
      defaultText: defaultText(key),
      override: overrides[key] ?? null,
    });
    return {
      items: [
        ...EDITABLE_TEXTS.miniApp.map(item('miniApp')),
        ...EDITABLE_TEXTS.bot.map(item('bot')),
      ],
      startLink,
      bot,
    };
  }

  /** Sets (or with null, removes) one override; refuses unsafe placeholders. */
  async setText(key: EditableTextKey, value: string | null, updatedBy: string): Promise<void> {
    if (value !== null) {
      const problem = overrideProblem(defaultText(key), value);
      if (problem) throw new AppError(ErrorCode.TEXT_PLACEHOLDER_INVALID, HttpStatus.BAD_REQUEST);
    }
    const current = await this.settings();
    const overrides = Object.fromEntries(
      Object.entries(current.overrides).filter(([k]) => k !== key),
    ) as TextSettings['overrides'];
    if (value !== null && value.trim() !== '') overrides[key] = value;
    await this.save({ ...current, overrides }, updatedBy);
  }

  async setStartLink(startLink: StartLinkButton | null, updatedBy: string): Promise<void> {
    await this.save({ ...(await this.settings()), startLink }, updatedBy);
  }

  /** D-145: support group and channel posts. */
  async setBotOptions(bot: BotOptions, updatedBy: string): Promise<void> {
    await this.save({ ...(await this.settings()), bot }, updatedBy);
  }

  /** Overrides of Mini App texts (public config). */
  async miniApp(): Promise<Record<string, string>> {
    const { overrides } = await this.settings();
    return Object.fromEntries(
      EDITABLE_TEXTS.miniApp.flatMap((key) => (overrides[key] ? [[key, overrides[key]]] : [])),
    );
  }

  /** Overrides of bot texts and the extra /start button (internal route for the bot). */
  async bot(): Promise<TextSettings> {
    const { overrides, startLink, bot } = await this.settings();
    return {
      bot,
      overrides: Object.fromEntries(
        [...EDITABLE_TEXTS.bot, ...BOT_SHARED_TEXTS].flatMap((key) =>
          overrides[key] ? [[key, overrides[key]]] : [],
        ),
      ),
      startLink,
    };
  }

  private async save(value: TextSettings, updatedBy: string): Promise<void> {
    const json = SettingsSchema.parse(value);
    await this.prisma.appSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: json, updatedBy },
      update: { value: json, updatedBy },
    });
  }
}
