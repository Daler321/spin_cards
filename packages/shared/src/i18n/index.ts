import adminRu from './locales/ru/admin.json' with { type: 'json' };
import botRu from './locales/ru/bot.json' with { type: 'json' };
import commonRu from './locales/ru/common.json' with { type: 'json' };
import errorsRu from './locales/ru/errors.json' with { type: 'json' };
import gameRu from './locales/ru/game.json' with { type: 'json' };
import shopRu from './locales/ru/shop.json' with { type: 'json' };

export const NAMESPACES = ['common', 'game', 'shop', 'errors', 'bot', 'admin'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const SUPPORTED_LANGUAGES = ['ru'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'ru';
export const DEFAULT_NAMESPACE: Namespace = 'common';

export const resources = {
  ru: {
    common: commonRu,
    game: gameRu,
    shop: shopRu,
    errors: errorsRu,
    bot: botRu,
    admin: adminRu,
  },
} as const satisfies Record<Language, Record<Namespace, object>>;

/** Maps a Telegram `language_code` (e.g. "en-US") to a supported language, falling back to ru. */
export function resolveLanguage(code: string | undefined | null): Language {
  const base = code?.toLowerCase().split('-')[0];
  return SUPPORTED_LANGUAGES.find((lang) => lang === base) ?? DEFAULT_LANGUAGE;
}

/** Base i18next options shared by web, admin and bot. ICU syntax requires the i18next-icu plugin. */
export function i18nOptions(lng: Language, ns: readonly Namespace[] = NAMESPACES) {
  return {
    lng,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: [...ns],
    defaultNS: DEFAULT_NAMESPACE,
    resources,
    interpolation: { escapeValue: false },
    returnNull: false,
  } as const;
}
