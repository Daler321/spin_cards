import {
  DEFAULT_LANGUAGE,
  BOT_SHARED_TEXTS,
  EDITABLE_TEXTS,
  i18nOptions,
  resolveLanguage,
  type BotOptions,
  type StartLinkButton,
  type TextSettings,
} from '@spincards/shared';
import i18next, { type TFunction } from 'i18next';
import ICU from 'i18next-icu';

export type Translator = (languageCode?: string) => TFunction<'bot'>;

export interface BotTexts {
  translator: Translator;
  /** Applies the owner's text overrides (D-134); removed ones fall back to the defaults. */
  apply: (settings: TextSettings) => void;
  /** The extra link button under /start, if the owner set one. */
  startLink: () => StartLinkButton | null;
  /** D-145: support group and channel posts, from the admin panel. */
  options: () => BotOptions;
}

export async function createBotTexts(): Promise<BotTexts> {
  const icu = new ICU();
  const instance = i18next.createInstance().use(icu);
  await instance.init(i18nOptions(DEFAULT_LANGUAGE));
  // `namespace:key` -> the default text, for every text an override may replace in the bot.
  const defaults = new Map(
    [...EDITABLE_TEXTS.bot, ...BOT_SHARED_TEXTS].map((id) => {
      const [ns = 'bot', key = ''] = id.split(':');
      return [id, { ns, key, text: String(instance.getResource(DEFAULT_LANGUAGE, ns, key) ?? '') }];
    }),
  );
  let link: StartLinkButton | null = null;
  let options: BotOptions = { supportChatId: null, channelPosts: false };
  return {
    translator: (languageCode) => instance.getFixedT(resolveLanguage(languageCode), 'bot'),
    apply: (settings) => {
      for (const [id, { ns, key, text }] of defaults) {
        const override = settings.overrides[id];
        instance.addResource(DEFAULT_LANGUAGE, ns, key, override ?? text);
      }
      link = settings.startLink;
      options = settings.bot;
      // Compiled messages are cached per key: the new texts must be compiled again.
      icu.clearCache();
    },
    startLink: () => link,
    options: () => options,
  };
}

export async function createI18n(): Promise<Translator> {
  return (await createBotTexts()).translator;
}
