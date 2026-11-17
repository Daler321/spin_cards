import { Bot, type Context, InlineKeyboard } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { TFunction } from 'i18next';
import type { Logger } from 'pino';
import type { BotOptions, StartLinkButton } from '@spincards/shared';
import type { InternalApi } from './api.js';
import { buildStartReply } from './start.js';

export interface BotDeps {
  token: string;
  api: InternalApi;
  translator: (languageCode?: string) => TFunction<'bot'>;
  publicUrl: string;
  logger: Logger;
  /** Test hook: bot info, so tests run without calling getMe. */
  botInfo?: UserFromGetMe;
  /** D-134: the owner's extra link button under /start. */
  startLink?: () => StartLinkButton | null;
  /** D-145: support group and channel posts (admin panel). */
  options?: () => BotOptions;
}

export const ALLOWED_UPDATES = [
  'message',
  'callback_query',
  'my_chat_member',
  'pre_checkout_query',
  'channel_post',
] as const;

const PAYMENT_ATTEMPTS = 3;
/** D-145: support messages a player may send per window (spam guard). */
const SUPPORT_LIMIT = 10;
const SUPPORT_WINDOW_MS = 3_600_000;
const NO_OPTIONS: BotOptions = { supportChatId: null, channelPosts: false };
/** /start payload of the Mini App's support button. */
const SUPPORT_PAYLOAD = 'support';
/** After "Support", the player's messages go to the support group for this long after the last. */
const SUPPORT_SESSION_MS = 15 * 60_000;
/** Media that can carry a caption: the support header goes into it. */
const CAPTIONED = ['photo', 'video', 'document', 'animation', 'audio', 'voice'] as const;

const profileOf = (ctx: Context) => {
  const from = ctx.from;
  if (!from) return null;
  return {
    telegramId: String(from.id),
    firstName: from.first_name,
    ...(from.last_name && { lastName: from.last_name }),
    ...(from.username && { username: from.username }),
    ...(from.language_code && { languageCode: from.language_code }),
  };
};

/** Bot handlers (TZ 14): /start with referral payload, help, rules, settings, blocks, Stars. */
export function createBot(deps: BotDeps): Bot {
  const { api, translator, publicUrl, logger } = deps;
  const bot = new Bot(deps.token, deps.botInfo ? { botInfo: deps.botInfo } : {});
  const tOf = (ctx: Context) => translator(ctx.from?.language_code);
  const appName = translator()('appName', { ns: 'common' });

  bot.command('start', async (ctx) => {
    const profile = profileOf(ctx);
    let isNew = true;
    if (profile) {
      try {
        const payload =
          typeof ctx.match === 'string' && ctx.match && ctx.match !== SUPPORT_PAYLOAD
            ? ctx.match
            : undefined;
        isNew = (await api.start({ user: profile, ...(payload && { payload }) })).isNew;
      } catch (error) {
        // The greeting still goes out; the Mini App signs the player in anyway.
        logger.error({ err: error }, 'start registration failed');
      }
    }
    // The support button of the Mini App opens the bot with this payload.
    if (ctx.match === SUPPORT_PAYLOAD) {
      await supportPrompt(ctx);
      return;
    }
    if (profile && !(await subscribed(ctx, profile.telegramId))) return;
    await sendStart(ctx, !isNew);
  });

  const sendStart = async (ctx: Context, returning: boolean) => {
    const link = deps.startLink?.() ?? null;
    const reply = buildStartReply(tOf(ctx), {
      firstName: ctx.from?.first_name ?? '',
      appName,
      publicUrl,
      returning,
      ...(link && { link }),
    });
    await ctx.reply(reply.text, reply.keyboard ? { reply_markup: reply.keyboard } : {});
  };

  /** Required channels (D-110): asks to join them first; true when the player may play. */
  const subscribed = async (ctx: Context, telegramId: string, fresh = false): Promise<boolean> => {
    let status;
    try {
      status = await api.subscription(telegramId, fresh);
    } catch (error) {
      logger.error({ err: error }, 'subscription check failed');
      return true;
    }
    if (status.ok) return true;
    const t = tOf(ctx);
    const keyboard = new InlineKeyboard();
    for (const channel of status.channels.filter((c) => !c.joined))
      keyboard.url(t('subscribe.join', { title: channel.title }), channel.url).row();
    keyboard.text(t('subscribe.check'), 'sub:check');
    await ctx.reply(t('subscribe.text'), { reply_markup: keyboard });
    return false;
  };

  bot.callbackQuery('sub:check', async (ctx) => {
    const t = tOf(ctx);
    const status = await api.subscription(String(ctx.from.id), true);
    if (!status.ok) {
      await ctx.answerCallbackQuery({ text: t('subscribe.notYet'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: t('subscribe.thanks') });
    await ctx.deleteMessage().catch(() => undefined);
    await sendStart(ctx, true);
  });

  bot.command('help', (ctx) => ctx.reply(tOf(ctx)('help')));

  bot.command('rules', (ctx) => {
    const t = tOf(ctx);
    return ctx.reply(`${t('rulesTitle')}\n\n${t('rules.body', { ns: 'common' })}`);
  });

  const settingsView = (t: TFunction<'bot'>, enabled: boolean) => ({
    text: t('settings.title', { enabled: String(enabled) }),
    keyboard: new InlineKeyboard().text(
      enabled ? t('settings.turnOff') : t('settings.turnOn'),
      enabled ? 'notify:off' : 'notify:on',
    ),
  });

  bot.command('settings', async (ctx) => {
    const t = tOf(ctx);
    const profile = profileOf(ctx);
    if (!profile) return;
    const { notificationsEnabled } = await api.start({ user: profile });
    const view = settingsView(t, notificationsEnabled);
    await ctx.reply(view.text, { reply_markup: view.keyboard });
  });

  bot.callbackQuery(/^notify:(on|off)$/, async (ctx) => {
    const t = tOf(ctx);
    const enabled = ctx.match[1] === 'on';
    await api.settings({ telegramId: String(ctx.from.id), notificationsEnabled: enabled });
    const view = settingsView(t, enabled);
    await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    await ctx.answerCallbackQuery({ text: t('settings.saved') });
  });

  // The player blocked or unblocked the bot in a private chat.
  bot.on('my_chat_member', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const status = ctx.myChatMember.new_chat_member.status;
    await api.chatStatus({ telegramId: String(ctx.from.id), blocked: status === 'kicked' });
  });

  bot.on('pre_checkout_query', async (ctx) => {
    const query = ctx.preCheckoutQuery;
    const t = tOf(ctx);
    try {
      const result = await api.preCheckout({
        telegramId: String(query.from.id),
        payload: query.invoice_payload,
        currency: query.currency,
        totalAmount: query.total_amount,
      });
      if (result.ok) await ctx.answerPreCheckoutQuery(true);
      else
        await ctx.answerPreCheckoutQuery(false, {
          error_message: t(result.error ?? 'PAYMENT_INVALID', { ns: 'errors' }),
        });
    } catch (error) {
      logger.error({ err: error }, 'pre-checkout check failed');
      await ctx.answerPreCheckoutQuery(false, {
        error_message: t('INTERNAL_ERROR', { ns: 'errors' }),
      });
    }
  });

  // Telegram has taken the Stars: credit with retries (the api is idempotent per charge id).
  bot.on('message:successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    const t = tOf(ctx);
    const request = {
      telegramId: String(ctx.from.id),
      payload: payment.invoice_payload,
      currency: payment.currency,
      totalAmount: payment.total_amount,
      telegramPaymentChargeId: payment.telegram_payment_charge_id,
    };
    for (let attempt = 1; ; attempt++) {
      try {
        await api.paymentSucceeded(request);
        await ctx.reply(t('payments.thanks'));
        return;
      } catch (error) {
        if (attempt >= PAYMENT_ATTEMPTS) {
          // The charge id is in the log for support to credit by hand (no other user data).
          logger.error(
            { err: error, chargeId: payment.telegram_payment_charge_id },
            'payment not credited',
          );
          await ctx.reply(t('payments.failed'));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  });

  // ─── Referral link (D-145) ────────────────────────────────────────────────
  const sendRef = async (ctx: Context) => {
    const t = tOf(ctx);
    const profile = profileOf(ctx);
    if (!profile) return;
    let code: string;
    try {
      code = (await api.start({ user: profile })).referralCode;
    } catch (error) {
      logger.error({ err: error }, 'referral link failed');
      await ctx.reply(t('ref.notRegistered'));
      return;
    }
    const link = `https://t.me/${ctx.me.username}?startapp=ref_${code}`;
    const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t('ref.shareText'))}`;
    await ctx.reply(t('ref.text', { link }), {
      reply_markup: new InlineKeyboard().url(t('ref.share'), share),
      link_preview_options: { is_disabled: true },
    });
  };
  bot.command('ref', sendRef);
  bot.callbackQuery('ref', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendRef(ctx);
  });

  // ─── Support through the owner's group (D-145) ────────────────────────────
  const options = () => deps.options?.() ?? NO_OPTIONS;
  const recent = new Map<number, number[]>();
  const allowSupport = (userId: number): boolean => {
    const now = Date.now();
    const times = (recent.get(userId) ?? []).filter((at) => now - at < SUPPORT_WINDOW_MS);
    const ok = times.length < SUPPORT_LIMIT;
    if (ok) times.push(now);
    recent.set(userId, times);
    return ok;
  };
  // Who is writing to support now: only messages sent after "Support" go to the group.
  const sessions = new Map<number, number>();
  const inSupport = (userId: number) => (sessions.get(userId) ?? 0) > Date.now();
  const supportPrompt = async (ctx: Context) => {
    const t = tOf(ctx);
    if (!options().supportChatId || !ctx.from) {
      await ctx.reply(t('support.off'));
      return;
    }
    sessions.set(ctx.from.id, Date.now() + SUPPORT_SESSION_MS);
    await ctx.reply(t('support.prompt'), {
      reply_markup: new InlineKeyboard().text(t('support.done'), 'support:done'),
    });
  };
  bot.callbackQuery('support:done', async (ctx) => {
    sessions.delete(ctx.from.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await ctx.reply(tOf(ctx)('support.closed'));
  });
  bot.command('support', supportPrompt);
  bot.callbackQuery('support', async (ctx) => {
    await ctx.answerCallbackQuery();
    await supportPrompt(ctx);
  });
  // The owner learns the group id here to put it into the admin panel.
  bot.command('chatid', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    await ctx.reply(translator()('chatId', { id: String(ctx.chat.id) }));
  });

  // A player's message in the private chat goes to support only after "Support" (a session).
  bot.chatType('private').on('message', async (ctx, next) => {
    const message = ctx.message;
    if (message.successful_payment || message.text?.startsWith('/')) return next();
    const t = tOf(ctx);
    const chatId = options().supportChatId;
    if (!chatId || !inSupport(ctx.from.id)) {
      sessions.delete(ctx.from.id);
      await ctx.reply(t('support.hint'), {
        reply_markup: new InlineKeyboard().text(t('start.supportButton'), 'support'),
      });
      return;
    }
    sessions.set(ctx.from.id, Date.now() + SUPPORT_SESSION_MS);
    if (!allowSupport(ctx.from.id)) {
      await ctx.reply(t('support.tooMany'));
      return;
    }
    const header = translator()('support.header', {
      name: ctx.from.first_name,
      username: ctx.from.username ? ` @${ctx.from.username}` : '',
      id: String(ctx.from.id),
    });
    try {
      if (message.text !== undefined) {
        await ctx.api.sendMessage(chatId, `${header}\n\n${message.text}`);
      } else if (CAPTIONED.some((kind) => message[kind] !== undefined)) {
        const caption = message.caption ? `${header}\n\n${message.caption}` : header;
        await ctx.api.copyMessage(chatId, ctx.chat.id, message.message_id, { caption });
      } else {
        await ctx.api.sendMessage(chatId, header);
        await ctx.api.copyMessage(chatId, ctx.chat.id, message.message_id);
      }
      await ctx.reply(t('support.sent'));
    } catch (error) {
      logger.error({ err: error }, 'support message not delivered');
      await ctx.reply(t('support.off'));
    }
  });

  // In the support group, a reply to the bot's support message goes back to the player.
  bot.on('message', async (ctx, next) => {
    const chatId = options().supportChatId;
    if (!chatId || String(ctx.chat.id) !== chatId) return next();
    const replied = ctx.message.reply_to_message;
    if (replied?.from?.id !== ctx.me.id) return next();
    const tag = /#id(\d+)/.exec(replied.text ?? replied.caption ?? '');
    if (!tag?.[1]) return next();
    const playerId = Number(tag[1]);
    const t = translator();
    try {
      if (ctx.message.text !== undefined) {
        await ctx.api.sendMessage(playerId, `${t('support.reply')}\n\n${ctx.message.text}`);
      } else {
        await ctx.api.sendMessage(playerId, t('support.reply'));
        await ctx.api.copyMessage(playerId, ctx.chat.id, ctx.message.message_id);
      }
      await ctx.reply(t('support.delivered'), {
        reply_parameters: { message_id: ctx.message.message_id },
      });
    } catch (error) {
      logger.warn({ err: error }, 'support reply not delivered');
      await ctx.reply(t('support.notDelivered'), {
        reply_parameters: { message_id: ctx.message.message_id },
      });
    }
  });

  // ─── Channel posts (D-145): the api decides whether and to whom ───────────
  bot.on('channel_post', async (ctx) => {
    const post = ctx.channelPost;
    try {
      await api.channelPost({
        chatId: String(post.chat.id),
        ...(post.chat.username && { chatUsername: post.chat.username }),
        messageId: post.message_id,
      });
    } catch (error) {
      logger.error({ err: error }, 'channel post not queued');
    }
  });

  bot.catch((error) => {
    logger.error({ err: error.error, updateId: error.ctx.update.update_id }, 'update failed');
  });

  return bot;
}

/** Command menu in Telegram (texts from i18n). */
export async function publishCommands(bot: Bot, t: TFunction<'bot'>): Promise<void> {
  const lines = t('help').split('\n').slice(1);
  const commands = lines
    .map((line) => /^\/(\w+) — (.+)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ command: m[1] ?? '', description: m[2] ?? '' }));
  await bot.api.setMyCommands(commands);
}
