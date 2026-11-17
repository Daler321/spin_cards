import type { TFunction } from 'i18next';
import type { StartLinkButton } from '@spincards/shared';
import { InlineKeyboard } from 'grammy';

export interface StartReply {
  text: string;
  keyboard?: InlineKeyboard;
}

/** Builds the /start reply. Telegram accepts web_app buttons only for HTTPS URLs. */
export function buildStartReply(
  t: TFunction<'bot'>,
  params: {
    firstName: string;
    appName: string;
    publicUrl: string;
    returning?: boolean;
    /** D-134: an extra link button (e.g. the news channel). */
    link?: StartLinkButton;
  },
): StartReply {
  const greeting = params.returning
    ? t('start.welcomeBack', { name: params.firstName })
    : t('start.greeting', { name: params.firstName, appName: params.appName });
  if (!params.publicUrl.startsWith('https://')) {
    return { text: `${greeting}\n\n${t('start.noWebApp')}` };
  }
  // D-145: a green Play button, then friends and support.
  const keyboard = new InlineKeyboard()
    .webApp(t('start.playButton'), params.publicUrl)
    .success()
    .row()
    .text(t('start.refButton'), 'ref')
    .text(t('start.supportButton'), 'support');
  if (params.link) keyboard.row().url(params.link.text, params.link.url);
  return { text: greeting, keyboard };
}
