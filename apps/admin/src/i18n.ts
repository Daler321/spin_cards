import { DEFAULT_LANGUAGE, i18nOptions } from '@spincards/shared';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';

// The admin panel is Russian-only for now.
export const i18nReady = i18next
  .use(new ICU())
  .use(initReactI18next)
  .init({ ...i18nOptions(DEFAULT_LANGUAGE, ['admin', 'common', 'errors']), defaultNS: 'admin' });
