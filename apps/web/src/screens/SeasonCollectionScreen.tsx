import { type Region, type SeasonCollectionResponse, TIERS } from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { useSeasonCollection } from '../api/queries';
import { OverlayScreen } from '../components/Overlay';
import { LOCALE } from '../lib/format';

/** The season collection (D-130): every bank × tier of the season, what is still missing. */
export default function SeasonCollectionScreen() {
  const { t } = useTranslation('game');
  const collection = useSeasonCollection();
  const data = collection.data;
  return (
    <OverlayScreen title={t('seasonCollection.title')}>
      {!data ? (
        <div className="screen-loading" aria-busy="true" />
      ) : (
        <div className="album">
          <p className="hint">{t('seasonCollection.hint', { season: data.season })}</p>
          <div className="album-progress">
            <strong>
              {t('seasonCollection.collected', { collected: data.collected, total: data.total })}
            </strong>
            <div
              className="luck-meter-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={data.total}
              aria-valuenow={data.collected}
            >
              <span
                className="luck-meter-fill"
                style={{ width: `${String((data.collected / Math.max(1, data.total)) * 100)}%` }}
              />
            </div>
          </div>
          {(['RU', 'US'] as Region[]).map((region) => (
            <BankSection key={region} region={region} banks={data.banks} />
          ))}
        </div>
      )}
    </OverlayScreen>
  );
}

function BankSection({
  region,
  banks,
}: {
  region: Region;
  banks: SeasonCollectionResponse['banks'];
}) {
  const { t } = useTranslation('game');
  const own = banks.filter((b) => b.region === region);
  if (own.length === 0) return null;
  return (
    <>
      <span className="section-label">{t(`seasonCollection.region.${region}`)}</span>
      <div className="album-banks">
        {own.map((bank) => (
          <div key={bank.id} className="album-bank">
            <span className="album-bank-name">
              <span className="album-dot" style={{ background: bank.color }} />
              {bank.name}
            </span>
            <div className="album-tiers">
              {TIERS.map((tier) => {
                const got = bank.tiers[tier];
                return (
                  <span
                    key={tier}
                    className={`album-tier album-tier--${tier} ${got ? 'is-got' : ''}`}
                    title={
                      got
                        ? t('seasonCollection.gotAt', {
                            date: new Intl.DateTimeFormat(LOCALE, {
                              day: 'numeric',
                              month: 'short',
                            }).format(new Date(got.at)),
                          })
                        : t('seasonCollection.missing')
                    }
                    style={got ? { borderColor: bank.color } : undefined}
                  >
                    {t(`tiers.${tier}`).slice(0, 1)}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
