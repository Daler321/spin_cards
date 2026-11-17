import { i18nOptions, NAMESPACES, resolveLanguage } from '@spincards/shared';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';
import { telegramLanguage } from './app/telegram';

/** Telegram user language first, then the browser; unsupported languages fall back to ru. */
const icu = new ICU();

export const i18nReady = i18next
  .use(icu)
  .use(initReactI18next)
  .init(
    i18nOptions(
      resolveLanguage(telegramLanguage() ?? navigator.language),
      NAMESPACES.filter((ns) => ns !== 'bot'),
    ),
  )
  .then(() => {
    // Overridden texts must re-render the screens that show them.
    i18next.options.react = { ...i18next.options.react, bindI18nStore: 'added' };
  });

/**
 * D-134: owner-edited texts (`ns:key` → text) replace the i18n defaults; components re-render on
 * the store change (react-i18next listens to 'added').
 */
export function applyTextOverrides(texts: Record<string, string>): void {
  const lng = i18next.language;
  const changed = Object.entries(texts).filter(([id, text]) => {
    const [ns, key] = id.split(':');
    return ns && key && i18next.getResource(lng, ns, key) !== text;
  });
  if (changed.length === 0) return;
  // Compiled messages are cached per key: drop them before the store change re-renders.
  icu.clearCache();
  for (const [id, text] of changed) {
    const [ns = '', key = ''] = id.split(':');
    i18next.addResource(lng, ns, key, text, { silent: false });
  }
}
