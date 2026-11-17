import type { Currency } from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { useMe, usePublicConfig, useReferrals } from '../api/queries';
import { haptics, openTelegramLink } from '../app/telegram';
import { OverlayScreen } from '../components/Overlay';
import { formatMoney, formatPercentBp } from '../lib/format';
import { regionCurrency } from '../lib/money';
import { referralLink } from '../lib/referral';
import { useToast } from '../state/toast';

/** D-177: the referral link first, then the invited friends, their progress and the earnings. */
export default function ReferralsScreen() {
  const { t } = useTranslation(['game', 'common']);
  const me = useMe();
  const config = usePublicConfig();
  const referrals = useReferrals();
  const toast = useToast((s) => s.show);
  if (!me.data || !config.data)
    return (
      <OverlayScreen title={t('profile.referral')}>
        <div className="screen-loading" aria-busy="true" />
      </OverlayScreen>
    );
  const currency: Currency = regionCurrency(me.data.region);
  const bot = config.data.botUsername;
  const link = bot ? referralLink(bot, me.data.referralCode) : `ref_${me.data.referralCode}`;
  const rules = config.data.referral;
  return (
    <OverlayScreen title={t('profile.referral')}>
      <section className="section">
        <p className="hint">
          {t(
            rules.referrerReward[currency] > 0
              ? 'profile.referralHintBoth'
              : 'profile.referralHint',
            {
              referred: formatMoney(rules.referredReward[currency], currency),
              referrer: formatMoney(rules.referrerReward[currency], currency),
              share: formatPercentBp(rules.commission.shareBp),
              days: rules.commission.days,
              spins: rules.spinsRequired,
              level: rules.levelRequired,
            },
          )}
        </p>
        <div className="referral-link">{link}</div>
        <div className="actions actions--row">
          <button
            type="button"
            className="button"
            onClick={() => {
              void navigator.clipboard.writeText(link).then(
                () => {
                  toast(t('common:copied'), 'success');
                },
                () => undefined,
              );
            }}
          >
            {t('profile.copyLink')}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              haptics.impact('light');
              openTelegramLink(
                `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t('profile.shareText'))}`,
              );
            }}
          >
            {t('profile.share')}
          </button>
        </div>
        {referrals.data && referrals.data.invited.length > 0 && (
          <p className="hint">
            {t('profile.referralTotals', {
              invited: referrals.data.invited.length,
              done: referrals.data.invited.filter((r) => r.status === 'rewarded').length,
              amount:
                totals(referrals.data.invited)
                  .map((e) => formatMoney(e.amount, e.currency))
                  .join(' + ') || formatMoney(0, currency),
            })}
          </p>
        )}
        {referrals.data && referrals.data.invited.length > 0 && (
          <div className="list">
            <span className="hint">{t('profile.invited')}</span>
            {referrals.data.invited.map((r) => (
              <div key={`${r.firstName}-${r.joinedAt}`} className="list-row">
                <div className="list-main">
                  <strong>{r.firstName}</strong>
                  <span className="hint">
                    {t('profile.invitedProgress', {
                      spins: r.spins,
                      needSpins: referrals.data.spinsRequired,
                      level: r.level,
                    })}
                    {r.earned.length > 0 &&
                      ` · ${t('profile.earned', {
                        amount: r.earned.map((e) => formatMoney(e.amount, e.currency)).join(' + '),
                      })}`}
                  </span>
                </div>
                <span className={`chip ${r.status === 'rewarded' ? 'chip--ok' : ''}`}>
                  {r.status === 'rewarded' ? t('profile.rewarded') : t('profile.pendingReward')}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </OverlayScreen>
  );
}

/** Everything earned from all friends, per currency. */
function totals(invited: { earned: { currency: string; amount: number }[] }[]) {
  const sums = new Map<string, number>();
  for (const r of invited)
    for (const e of r.earned) sums.set(e.currency, (sums.get(e.currency) ?? 0) + e.amount);
  return [...sums].map(([currency, amount]) => ({ currency, amount }));
}
