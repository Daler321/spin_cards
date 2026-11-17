import { describe, expect, it } from 'vitest';
import { createBotTexts, createI18n } from '../src/i18n.js';
import { buildStartReply } from '../src/start.js';

const NO_OPTIONS = { supportChatId: null, channelPosts: false };
const translator = await createI18n();
const t = translator('ru');

describe('buildStartReply', () => {
  it('greets the user in Russian with a Mini App button for HTTPS URLs', () => {
    const reply = buildStartReply(t, {
      firstName: 'Аня',
      appName: 'SpinCards',
      publicUrl: 'https://example.trycloudflare.com',
    });
    expect(reply.text).toBe(
      'Привет, Аня! Это SpinCards: выпускай игровые карты с красивыми номерами и собирай коллекцию.',
    );
    // D-145: a green Play button, then friends and support.
    expect(reply.keyboard?.inline_keyboard).toEqual([
      [{ text: 'Играть', web_app: { url: 'https://example.trycloudflare.com' }, style: 'success' }],
      [
        { text: '🤝 Пригласить друзей', callback_data: 'ref' },
        { text: '💬 Поддержка', callback_data: 'support' },
      ],
    ]);
  });

  it('omits the button when the public URL is not HTTPS', () => {
    const reply = buildStartReply(t, {
      firstName: 'Аня',
      appName: 'SpinCards',
      publicUrl: 'http://localhost:8080',
    });
    expect(reply.keyboard).toBeUndefined();
    expect(reply.text).toContain('Мини-приложение пока недоступно');
  });

  it('falls back to Russian for unsupported languages', () => {
    expect(translator('en')('start.playButton')).toBe('Играть');
  });

  it("applies the owner's texts and the extra link button (D-134)", async () => {
    const texts = await createBotTexts();
    texts.apply({
      overrides: { 'bot:start.greeting': 'Здравствуй, {name}!', 'bot:start.playButton': 'В игру' },
      startLink: { text: 'Канал', url: 'https://t.me/spincards' },
      bot: NO_OPTIONS,
    });
    const link = texts.startLink();
    const reply = buildStartReply(texts.translator('ru'), {
      firstName: 'Аня',
      appName: 'SpinCards',
      publicUrl: 'https://game.example',
      ...(link && { link }),
    });
    expect(reply.text).toBe('Здравствуй, Аня!');
    expect(reply.keyboard?.inline_keyboard).toEqual([
      [{ text: 'В игру', web_app: { url: 'https://game.example' }, style: 'success' }],
      [
        { text: '🤝 Пригласить друзей', callback_data: 'ref' },
        { text: '💬 Поддержка', callback_data: 'support' },
      ],
      [{ text: 'Канал', url: 'https://t.me/spincards' }],
    ]);
    // Removing an override brings the default back.
    texts.apply({ overrides: {}, startLink: null, bot: NO_OPTIONS });
    expect(texts.translator('ru')('start.playButton')).toBe('Играть');
    expect(texts.startLink()).toBeNull();
  });

  it('applies an edited rules text to /rules too (shared with the Mini App)', async () => {
    const texts = await createBotTexts();
    const t = texts.translator('ru');
    expect(t('rules.body', { ns: 'common' })).toContain('баланс игры');
    texts.apply({
      overrides: { 'common:rules.body': 'Новые правила.' },
      startLink: null,
      bot: NO_OPTIONS,
    });
    expect(t('rules.body', { ns: 'common' })).toBe('Новые правила.');
  });
});
