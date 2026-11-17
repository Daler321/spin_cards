import type { Currency, PublicConfigResponse } from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { haptics, shareURL } from '../app/telegram';
import { formatMoney, formatPercentBp } from '../lib/format';
import { referralLink } from '../lib/referral';

/** Home call to invite friends: rewards come from the config, one tap opens Telegram's share sheet. */
export function InviteBanner({
  config,
  referralCode,
  currency,
}: {
  config: PublicConfigResponse;
  referralCode: string;
  currency: Currency;
}) {
  const { t } = useTranslation('game');
  if (!config.botUsername) return null;
  const rules = config.referral;
  return (
    <button
      type="button"
      className="invite-banner"
      onClick={() => {
        haptics.impact('light');
        shareURL(referralLink(config.botUsername, referralCode), t('profile.shareText'));
      }}
    >
      <span className="invite-banner-text">
        <b>{t('invite.title')}</b>
        <span>
          {rules.referrerReward[currency] > 0
            ? t('invite.rewards', {
                you: formatMoney(rules.referrerReward[currency], currency),
                share: formatPercentBp(rules.commission.shareBp),
                friend: formatMoney(rules.referredReward[currency], currency),
              })
            : t('invite.rewardsShare', {
                share: formatPercentBp(rules.commission.shareBp),
                friend: formatMoney(rules.referredReward[currency], currency),
              })}
        </span>
      </span>
      <span className="invite-banner-cta">{t('invite.cta')}</span>
    </button>
  );
}
