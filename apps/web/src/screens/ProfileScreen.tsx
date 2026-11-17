import { TIERS } from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { useMe, usePublicConfig, useSettings, useStats } from '../api/queries';
import { haptics, openTelegramLink } from '../app/telegram';
import { OverlayScreen } from '../components/Overlay';
import { LOCALE } from '../lib/format';
import { useNavigation } from '../state/navigation';
import { PROFILE_TABS, useUi } from '../state/ui';

export default function ProfileScreen() {
  const { t } = useTranslation(['game', 'common']);
  const me = useMe();
  const stats = useStats();
  const config = usePublicConfig();
  const settings = useSettings();
  const open = useNavigation((s) => s.open);
  const tab = useUi((s) => s.profileTab);
  const setTab = useUi((s) => s.setProfileTab);
  if (!me.data || !config.data)
    return (
      <OverlayScreen title={t('profile.title')}>
        <div className="screen-loading" />
      </OverlayScreen>
    );

  const bot = config.data.botUsername;

  return (
    <OverlayScreen title={t('profile.title')}>
      <div className="profile-head">
        {me.data.photoUrl ? (
          <img className="avatar avatar--large" src={me.data.photoUrl} alt="" />
        ) : (
          <span className="avatar avatar--large avatar--initial">
            {me.data.firstName.slice(0, 1)}
          </span>
        )}
        <div>
          <h2>{me.data.firstName}</h2>
          <span className="hint">
            {t('header.level', { level: me.data.level })} · {me.data.exp} EXP
          </span>
        </div>
      </div>

      <div className="segmented segmented--wide" role="tablist" aria-label={t('profile.title')}>
        {PROFILE_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'is-active' : ''}
            onClick={() => {
              haptics.select();
              setTab(id);
            }}
          >
            {t(`profile.tabs.${id}`)}
          </button>
        ))}
      </div>

      {tab === 'info' && (
        <>
          {stats.data && (
            <section className="section">
              <h3>{t('profile.stats')}</h3>
              <dl className="facts">
                <div className="fact">
                  <dt>{t('profile.seasonSpins', { season: stats.data.season.name })}</dt>
                  <dd>{stats.data.season.spins}</dd>
                </div>
                <div className="fact">
                  <dt>{t('profile.totalSpins')}</dt>
                  <dd>{stats.data.totalSpins}</dd>
                </div>
                <div className="fact">
                  <dt>{t('profile.bestRarity')}</dt>
                  <dd>{stats.data.season.bestRarity}</dd>
                </div>
                <div className="fact">
                  <dt>{t('profile.holder')}</dt>
                  <dd>
                    {stats.data.holder.cards} / {stats.data.holder.slots}
                  </dd>
                </div>
                <div className="fact fact--wide">
                  <dt>{t('profile.seasonPoints')}</dt>
                  <dd>
                    {new Intl.NumberFormat(LOCALE).format(stats.data.season.score.total)}
                    <span className="fact-detail">
                      {t('profile.scoreParts', {
                        cards: stats.data.season.score.cards,
                        money: stats.data.season.score.money,
                        level: stats.data.season.score.level,
                      })}
                    </span>
                  </dd>
                </div>
              </dl>
              {stats.data.pastSeasons.length > 0 && (
                <>
                  <span className="section-label">{t('profile.pastSeasons')}</span>
                  <ul className="season-rewards">
                    {stats.data.pastSeasons.map((s) => (
                      <li key={s.name}>
                        <span>{s.name}</span>
                        <b>{t('rating.place', { rank: s.rank })}</b>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          <div className="list">
            <button
              type="button"
              className="list-row list-row--link"
              onClick={() => {
                open({ name: 'referrals' });
              }}
            >
              {t('profile.referral')}
            </button>
            <button
              type="button"
              className="list-row list-row--link"
              onClick={() => {
                open({ name: 'medals' });
              }}
            >
              {t('medals.short')}
            </button>
          </div>
        </>
      )}

      {tab === 'settings' && (
        <>
          <section className="section">
            <h3>{t('profile.settings')}</h3>
            <Toggle
              label={t('profile.notifications')}
              checked={me.data.settings.notificationsEnabled}
              onChange={(v) => {
                settings.mutate({ notificationsEnabled: v });
              }}
            />
            <Toggle
              label={t('profile.hideFromRating')}
              checked={me.data.settings.hideFromLeaderboard}
              onChange={(v) => {
                settings.mutate({ hideFromLeaderboard: v });
              }}
            />
          </section>

          <section className="section">
            <h3>{t('profile.autoSell')}</h3>
            <p className="hint">{t('profile.autoSellHint')}</p>
            {TIERS.map((tier) => (
              <Toggle
                key={tier}
                label={t(`tiers.${tier}`)}
                checked={me.data.settings.autoCashoutTiers.includes(tier)}
                onChange={(v) => {
                  const now = me.data.settings.autoCashoutTiers;
                  settings.mutate({
                    autoCashoutTiers: v ? [...now, tier] : now.filter((x) => x !== tier),
                  });
                }}
              />
            ))}
          </section>

          <section className="section links">
            <button
              type="button"
              className="list-row list-row--link"
              onClick={() => {
                open({ name: 'odds' });
              }}
            >
              {t('profile.odds')}
            </button>
            <button
              type="button"
              className="list-row list-row--link"
              onClick={() => {
                open({ name: 'rules' });
              }}
            >
              {t('profile.rules')}
            </button>
            <button
              type="button"
              className="list-row list-row--link"
              onClick={() => {
                open({ name: 'privacy' });
              }}
            >
              {t('profile.privacy')}
            </button>
            {bot && (
              // D-145: opens the bot chat ready for a support message.
              <button
                type="button"
                className="list-row list-row--link"
                onClick={() => {
                  openTelegramLink(`https://t.me/${bot}?start=support`);
                }}
              >
                {t('profile.support')}
              </button>
            )}
          </section>
        </>
      )}
    </OverlayScreen>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => {
          haptics.select();
          onChange(e.target.checked);
        }}
      />
    </label>
  );
}
