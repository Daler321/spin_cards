import { useTranslation } from 'react-i18next';
import { useSeasons } from '../api/queries';
import { OverlayScreen } from '../components/Overlay';
import { LOCALE } from '../lib/format';
import { useNow } from '../lib/useNow';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const date = (iso: string) =>
  new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/** D-177: the current season: its number, length, how much is left; the earlier seasons below. */
export default function SeasonsScreen() {
  const { t } = useTranslation('game');
  const seasons = useSeasons();
  const now = useNow();
  const data = seasons.data;
  if (!data)
    return (
      <OverlayScreen title={t('seasons.title')}>
        <div className="screen-loading" aria-busy="true" />
      </OverlayScreen>
    );
  const { current, past } = data;
  const start = Date.parse(current.startsAt);
  const end = current.endsAt ? Date.parse(current.endsAt) : null;
  const progress = end ? Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start))) : 0;
  return (
    <OverlayScreen title={t('seasons.title')}>
      <section className="section">
        <h3>{current.name}</h3>
        <dl className="facts">
          {current.number !== null && (
            <div className="fact">
              <dt>{t('seasons.number')}</dt>
              <dd>{current.number}</dd>
            </div>
          )}
          <div className="fact">
            <dt>{t('seasons.played')}</dt>
            <dd>{current.finished}</dd>
          </div>
          <div className="fact">
            <dt>{t('seasons.started')}</dt>
            <dd>{date(current.startsAt)}</dd>
          </div>
          <div className="fact">
            <dt>{t('seasons.ends')}</dt>
            <dd>{current.endsAt ? date(current.endsAt) : t('seasons.noEnd')}</dd>
          </div>
          {end !== null && (
            <>
              <div className="fact">
                <dt>{t('seasons.length')}</dt>
                <dd>{t('seasons.days', { count: Math.round((end - start) / DAY) })}</dd>
              </div>
              <div className="fact">
                <dt>{t('seasons.left')}</dt>
                <dd>
                  {end > now
                    ? t('seasons.leftValue', {
                        days: Math.floor((end - now) / DAY),
                        hours: Math.floor(((end - now) % DAY) / HOUR),
                      })
                    : t('seasons.over')}
                </dd>
              </div>
            </>
          )}
        </dl>
        {end !== null && (
          <div
            className="luck-meter-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <span className="luck-meter-fill" style={{ width: `${String(progress * 100)}%` }} />
          </div>
        )}
        <p className="hint">{t('seasons.hint')}</p>
      </section>
      {past.length > 0 && (
        <section className="section">
          <h3>{t('seasons.past')}</h3>
          <ul className="season-rewards">
            {past.map((s) => (
              <li key={`${s.name}-${s.startsAt}`}>
                <span>{s.name}</span>
                <b>
                  {new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short' }).format(
                    new Date(s.startsAt),
                  )}
                  {s.endsAt &&
                    ` – ${new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short' }).format(new Date(s.endsAt))}`}
                </b>
              </li>
            ))}
          </ul>
        </section>
      )}
    </OverlayScreen>
  );
}
