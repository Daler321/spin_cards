import { PINNED_MEDALS_MAX } from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { useAchievements, useSettings } from '../api/queries';
import { haptics } from '../app/telegram';
import { OverlayScreen } from '../components/Overlay';
import { errorText } from '../lib/errors';
import { formatPercentBp } from '../lib/format';
import { useToast } from '../state/toast';

/** D-177: medals on their own screen from «Ещё». */
export default function MedalsScreen() {
  const { t } = useTranslation('game');
  return (
    <OverlayScreen title={t('medals.short')}>
      <Medals />
    </OverlayScreen>
  );
}

/** D-133: medals earned (with the season for season medals) and the ones still locked. */
function Medals() {
  const { t } = useTranslation('game');
  const list = useAchievements();
  const settings = useSettings();
  const toast = useToast((s) => s.show);
  if (!list.data) return null;
  const { achievements, shown, chosen } = list.data;
  const earned = achievements.filter((a) => a.earned.length > 0).length;
  // D-137: tapping an earned medal pins it to the rating (up to 3); none pinned shows the rarest.
  const save = (pinnedMedals: string[]) => {
    haptics.impact('light');
    settings.mutate(
      { pinnedMedals },
      {
        onSuccess: () => void list.refetch(),
        onError: (e) => {
          toast(errorText(t, e), 'error');
        },
      },
    );
  };
  const toggle = (id: string) => {
    const base = chosen ? shown : [];
    if (base.includes(id)) save(base.filter((x) => x !== id));
    else if (base.length < PINNED_MEDALS_MAX) save([...base, id]);
    else toast(t('medals.pinLimit', { count: PINNED_MEDALS_MAX }), 'info');
  };
  return (
    <section className="section">
      <h3>{t('medals.title', { earned, total: achievements.length })}</h3>
      <p className="hint">
        {chosen
          ? t('medals.pinnedHint', { count: PINNED_MEDALS_MAX })
          : t('medals.rarestHint', { count: PINNED_MEDALS_MAX })}
        {chosen && (
          <>
            {' '}
            <button
              type="button"
              className="link-button"
              disabled={settings.isPending}
              onClick={() => {
                save([]);
              }}
            >
              {t('medals.reset')}
            </button>
          </>
        )}
      </p>
      <div className="medals">
        {achievements.map((a) => {
          const has = a.earned.length > 0;
          const isShown = shown.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              disabled={!has || settings.isPending}
              aria-pressed={isShown}
              className={`medal ${has ? 'is-earned' : ''} ${isShown ? 'is-shown' : ''}`}
              onClick={() => {
                toggle(a.id);
              }}
            >
              <span className="medal-icon">{a.icon}</span>
              <span className="medal-title">{t(`achievements.${a.id}.title`)}</span>
              <span className="medal-desc">
                {a.earned.length > 1
                  ? t('medals.times', { count: a.earned.length })
                  : (a.earned[0]?.season ?? t(`achievements.${a.id}.desc`))}
              </span>
              {has && (
                <span className="medal-rarity">
                  {t('medals.holders', { percent: formatPercentBp(a.holdersBp) })}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
