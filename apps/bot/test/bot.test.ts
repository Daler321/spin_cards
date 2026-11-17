import type { ClaimNotificationsResponse } from '@spincards/shared';
import { GrammyError } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { InternalApi } from '../src/api.js';
import { createBot } from '../src/bot.js';
import { createI18n } from '../src/i18n.js';
import { Notifier } from '../src/notifier.js';

const translator = await createI18n();
const logger = pino({ level: 'silent' });
const botInfo: UserFromGetMe = {
  id: 1,
  is_bot: true,
  first_name: 'SpinCards',
  username: 'spincards_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};
const from = { id: 42, is_bot: false, first_name: 'Аня', language_code: 'ru' };
const chat = { id: 42, type: 'private' as const, first_name: 'Аня' };

const defaults = () => ({
  start: vi.fn(() =>
    Promise.resolve({ isNew: true, notificationsEnabled: true, referralCode: 'ABCD2345' }),
  ),
  channelPost: vi.fn(() => Promise.resolve({ queued: 3 })),
  subscription: vi.fn(() => Promise.resolve({ required: false, ok: true, channels: [] })),
  settings: vi.fn(() => Promise.resolve(undefined)),
  chatStatus: vi.fn(() => Promise.resolve(undefined)),
  claim: vi.fn(),
  report: vi.fn(() => Promise.resolve(undefined)),
  preCheckout: vi.fn(() => Promise.resolve({ ok: true })),
  paymentSucceeded: vi.fn(() => Promise.resolve({ credited: true, productId: 'p' })),
});

function fakeApi(overrides: Partial<Record<keyof InternalApi, unknown>> = {}) {
  return { ...defaults(), ...overrides } as ReturnType<typeof defaults>;
}

/** A bot whose outgoing Telegram calls are recorded instead of sent. */
function setup(api = fakeApi(), supportChatId: string | null = null) {
  const bot = createBot({
    token: 'test',
    api: api as unknown as InternalApi,
    translator,
    publicUrl: 'https://game.example',
    logger,
    botInfo,
    options: () => ({ supportChatId, channelPosts: true }),
  });
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload });
    return Promise.resolve({ ok: true, result: true } as never);
  });
  return { bot, api, calls };
}

let updateId = 1;
const message = (text: string): Update => ({
  update_id: updateId++,
  message: {
    message_id: updateId,
    date: 0,
    chat,
    from,
    text,
    ...(text.startsWith('/') && {
      entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }],
    }),
  },
});

describe('bot handlers', () => {
  it('/start registers with the referral payload and opens the Mini App', async () => {
    const { bot, api, calls } = setup();
    await bot.handleUpdate(message('/start ref_ABCD2345'));
    expect(api.start).toHaveBeenCalledWith({
      user: { telegramId: '42', firstName: 'Аня', languageCode: 'ru' },
      payload: 'ref_ABCD2345',
    });
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: 42,
        text: expect.stringContaining('Привет, Аня!') as string,
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Играть', web_app: { url: 'https://game.example' }, style: 'success' }],
            [
              { text: '🤝 Пригласить друзей', callback_data: 'ref' },
              { text: '💬 Поддержка', callback_data: 'support' },
            ],
          ],
        },
      },
    });
  });

  it('asks to join required channels before the game button', async () => {
    const api = fakeApi({
      subscription: vi.fn(() =>
        Promise.resolve({
          required: true,
          ok: false,
          channels: [{ title: 'Новости', url: 'https://t.me/news', joined: false }],
        }),
      ),
    });
    const { bot, calls } = setup(api);
    await bot.handleUpdate(message('/start'));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toMatchObject({
      text: expect.stringContaining('подпишитесь') as string,
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Подписаться: Новости', url: 'https://t.me/news' }],
          [{ text: 'Я подписался', callback_data: 'sub:check' }],
        ],
      },
    });
  });

  it('welcomes a returning player back and still answers when the api is down', async () => {
    const returning = setup(fakeApi({ start: vi.fn(() => Promise.resolve({ isNew: false })) }));
    await returning.bot.handleUpdate(message('/start'));
    expect(returning.calls[0]?.payload.text).toBe('С возвращением, Аня! Карты ждут.');

    const down = setup(fakeApi({ start: vi.fn(() => Promise.reject(new Error('down'))) }));
    await down.bot.handleUpdate(message('/start'));
    expect(down.calls[0]?.payload.text).toContain('Привет, Аня!');
  });

  it('toggles notifications from /settings', async () => {
    const { bot, api, calls } = setup();
    await bot.handleUpdate(message('/settings'));
    expect(calls[0]?.payload.text).toContain('Уведомления: включены');
    await bot.handleUpdate({
      update_id: updateId++,
      callback_query: {
        id: 'cb',
        from,
        chat_instance: 'x',
        data: 'notify:off',
        message: { message_id: 5, date: 0, chat, text: 'x' },
      },
    });
    expect(api.settings).toHaveBeenCalledWith({ telegramId: '42', notificationsEnabled: false });
    expect(calls.find((c) => c.method === 'editMessageText')?.payload.text).toContain(
      'Уведомления: выключены',
    );
  });

  it('reports blocks and unblocks', async () => {
    const { bot, api } = setup();
    const member = (status: 'kicked' | 'member'): Update => ({
      update_id: updateId++,
      my_chat_member: {
        chat,
        from,
        date: 0,
        old_chat_member: { status: 'member', user: botInfo },
        new_chat_member:
          status === 'kicked'
            ? { status: 'kicked', user: botInfo, until_date: 0 }
            : { status: 'member', user: botInfo },
      },
    });
    await bot.handleUpdate(member('kicked'));
    await bot.handleUpdate(member('member'));
    expect(api.chatStatus.mock.calls).toEqual([
      [{ telegramId: '42', blocked: true }],
      [{ telegramId: '42', blocked: false }],
    ]);
  });

  it('checks Stars payments before and credits them after', async () => {
    const { bot, api, calls } = setup(
      fakeApi({
        preCheckout: vi.fn(() => Promise.resolve({ ok: false, error: 'PAYMENTS_DISABLED' })),
      }),
    );
    await bot.handleUpdate({
      update_id: updateId++,
      pre_checkout_query: {
        id: 'q1',
        from,
        currency: 'XTR',
        total_amount: 50,
        invoice_payload: 'pay-1',
      },
    });
    expect(calls[0]).toMatchObject({
      method: 'answerPreCheckoutQuery',
      payload: { pre_checkout_query_id: 'q1', ok: false, error_message: 'Оплата пока недоступна' },
    });

    await bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: 9,
        date: 0,
        chat,
        from,
        successful_payment: {
          currency: 'XTR',
          total_amount: 50,
          invoice_payload: 'pay-1',
          telegram_payment_charge_id: 'ch-1',
          provider_payment_charge_id: '',
        },
      },
    });
    expect(api.paymentSucceeded).toHaveBeenCalledWith({
      telegramId: '42',
      payload: 'pay-1',
      currency: 'XTR',
      totalAmount: 50,
      telegramPaymentChargeId: 'ch-1',
    });
    expect(calls.at(-1)?.payload.text).toBe('Спасибо! Покупка зачислена.');
  });
});

describe('Notifier', () => {
  it('sends claimed messages and reports each outcome', async () => {
    const claim: ClaimNotificationsResponse = {
      perSecond: 1000,
      items: [
        { id: 'a', kind: 'free_spin_ready', telegramId: '1', languageCode: 'ru', params: {} },
        { id: 'b', kind: 'comeback', telegramId: '2', languageCode: null, params: {} },
      ],
    };
    const api = fakeApi({ claim: vi.fn(() => Promise.resolve(claim)) });
    const sendMessage = vi.fn((chatId: number) =>
      chatId === 2
        ? Promise.reject(
            new GrammyError(
              'blocked',
              { ok: false, error_code: 403, description: 'Forbidden' },
              'sendMessage',
              {},
            ),
          )
        : Promise.resolve({}),
    );
    const notifier = new Notifier({
      api: api as unknown as InternalApi,
      telegram: { sendMessage } as never,
      translator,
      publicUrl: '',
      pollMs: 10,
      logger,
    });
    expect(await notifier.tick()).toBe(2);
    expect(sendMessage.mock.calls[0]?.[0]).toBe(1);
    expect(api.report.mock.calls).toEqual([
      ['a', { outcome: 'sent' }],
      ['b', { outcome: 'blocked' }],
    ]);
  });
});

describe('support, referral link and channel posts (D-145)', () => {
  const GROUP = -1001234567890;

  it('/ref sends the referral link with a share button', async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate(message('/ref'));
    const sent = calls.find((c) => c.method === 'sendMessage');
    expect(String(sent?.payload.text)).toContain(
      'https://t.me/spincards_bot?startapp=ref_ABCD2345',
    );
    expect(JSON.stringify(sent?.payload.reply_markup)).toContain('t.me/share/url');
  });

  it('keeps chat messages out of support until the player presses "Support"', async () => {
    const { bot, calls } = setup(fakeApi(), String(GROUP));
    await bot.handleUpdate(message('просто привет'));
    expect(calls.some((c) => c.payload.chat_id === String(GROUP))).toBe(false);
    expect(String(calls[0]?.payload.text)).toContain('нажмите «Поддержка»');
  });

  it('opens a support session from the Mini App link (/start support)', async () => {
    const { bot, api, calls } = setup(fakeApi(), String(GROUP));
    await bot.handleUpdate(message('/start support'));
    expect(api.start).toHaveBeenCalledWith({
      user: { telegramId: '42', firstName: 'Аня', languageCode: 'ru' },
    });
    expect(String(calls.at(-1)?.payload.text)).toContain('Завершить обращение');
    await bot.handleUpdate(message('Помогите с картой'));
    expect(calls.some((c) => c.payload.chat_id === String(GROUP))).toBe(true);
  });

  it('forwards a player message to the support group, and the reply back to the player', async () => {
    const { bot, calls } = setup(fakeApi(), String(GROUP));
    await bot.handleUpdate(message('/support'));
    await bot.handleUpdate(message('Не открывается холдер'));
    const toGroup = calls.find(
      (c) => c.method === 'sendMessage' && c.payload.chat_id === String(GROUP),
    );
    expect(String(toGroup?.payload.text)).toContain('#id42');
    expect(String(toGroup?.payload.text)).toContain('Не открывается холдер');
    expect(calls.some((c) => c.method === 'sendMessage' && c.payload.chat_id === 42)).toBe(true);

    calls.length = 0;
    await bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: 900,
        date: 0,
        chat: { id: GROUP, type: 'supergroup', title: 'Support' },
        from: { id: 7, is_bot: false, first_name: 'Админ' },
        text: 'Уже чиним, спасибо!',
        reply_to_message: {
          message_id: 899,
          date: 0,
          chat: { id: GROUP, type: 'supergroup', title: 'Support' },
          from: { id: botInfo.id, is_bot: true, first_name: 'SpinCards' },
          text: '🆘 Аня · #id42\n\nНе открывается холдер',
        },
      },
    } as Update);
    const toPlayer = calls.find((c) => c.method === 'sendMessage' && c.payload.chat_id === 42);
    expect(String(toPlayer?.payload.text)).toContain('Уже чиним, спасибо!');
  });

  it('tells the player when support is not set up', async () => {
    const { bot, calls } = setup();
    await bot.handleUpdate(message('/support'));
    expect(String(calls[0]?.payload.text)).toContain('Поддержка пока недоступна');
  });

  it('reports channel posts to the api', async () => {
    const { bot, api } = setup();
    await bot.handleUpdate({
      update_id: updateId++,
      channel_post: {
        message_id: 55,
        date: 0,
        chat: { id: -1009876543210, type: 'channel', title: 'News', username: 'spincards_news' },
        text: 'Новый сезон!',
      },
    });
    expect(api.channelPost).toHaveBeenCalledWith({
      chatId: '-1009876543210',
      chatUsername: 'spincards_news',
      messageId: 55,
    });
  });
});
