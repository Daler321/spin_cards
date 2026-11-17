import type { SubscriptionStatus } from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { useSubscriptionCheck } from '../api/queries';
import { haptics, openTelegramLink } from '../app/telegram';

/** Shown instead of the game until the player has joined every required channel (D-110). */
export function SubscribeScreen({ status }: { status: SubscriptionStatus }) {
  const { t } = useTranslation('game');
  const check = useSubscriptionCheck();
  const missing = status.channels.filter((c) => !c.joined);
  return (
    <div className="screen-message subscribe">
      <h1>{t('subscribe.title')}</h1>
      <p>{t('subscribe.text', { count: missing.length })}</p>
      <div className="subscribe-channels">
        {status.channels.map((channel) => (
          <button
            key={channel.url}
            type="button"
            className={`button ${channel.joined ? '' : 'button--primary'}`}
            disabled={channel.joined}
            onClick={() => {
              openTelegramLink(channel.url);
            }}
          >
            {channel.joined ? `✓ ${channel.title}` : t('subscribe.join', { title: channel.title })}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="button"
        disabled={check.isPending}
        onClick={() => {
          check.mutate(undefined, {
            onSuccess: (next) => {
              haptics.notify(next.ok ? 'success' : 'warning');
            },
          });
        }}
      >
        {t('subscribe.check')}
      </button>
      {check.data && !check.data.ok && <p className="hint">{t('subscribe.notYet')}</p>}
    </div>
  );
}
