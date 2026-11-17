import type { PlayerProfileResponse } from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { LOCALE } from '../lib/format';
import { Card } from './card/Card';

/** A player's public profile: level, spins, collection, album and rarest cards (rating, search). */
export function PlayerProfileView({ p }: { p: PlayerProfileResponse }) {
  const { t } = useTranslation('game');
  return (
    <div className="player-sheet">
      <div className="player-head">
        {p.photoUrl ? (
          <img className="avatar" src={p.photoUrl} alt="" />
        ) : (
          <span className="avatar avatar--initial">{p.firstName.slice(0, 1)}</span>
        )}
        <div>
          <h3>{p.firstName}</h3>
          <span className="hint">{t('header.level', { level: p.level })}</span>
          {p.medals.length > 0 && <span className="player-medals">{p.medals.join(' ')}</span>}
        </div>
      </div>
      <dl className="facts">
        <div className="fact">
          <dt>{t('rating.profile.seasonSpins')}</dt>
          <dd>{new Intl.NumberFormat(LOCALE).format(p.seasonSpins)}</dd>
        </div>
        <div className="fact">
          <dt>{t('rating.profile.spins')}</dt>
          <dd>{new Intl.NumberFormat(LOCALE).format(p.totalSpins)}</dd>
        </div>
        <div className="fact">
          <dt>{t('rating.profile.since')}</dt>
          <dd>
            {new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' }).format(
              new Date(p.memberSince),
            )}
          </dd>
        </div>
        <div className="fact fact--wide">
          <dt>{t('rating.profile.collection', { level: p.collection.level })}</dt>
          <dd>
            {t('rating.profile.score', {
              score: p.collection.score,
              cards: p.collection.cards,
            })}
          </dd>
        </div>
      </dl>
      {p.trophies.length > 0 && (
        <>
          <span className="section-label">{t('album.trophies')}</span>
          <div className="player-cards">
            {p.trophies.map((card) => (
              <Card
                key={card.id}
                card={card}
                holderName={p.firstName}
                animated={false}
                className="gc--fluid"
              />
            ))}
          </div>
        </>
      )}
      <span className="section-label">{t('rating.profile.topCards')}</span>
      {p.topCards.length === 0 ? (
        <p className="hint">{t('rating.profile.noCards')}</p>
      ) : (
        <div className="player-cards">
          {p.topCards.map((card) => (
            <Card
              key={card.id}
              card={card}
              holderName={p.firstName}
              animated={false}
              className="gc--fluid"
            />
          ))}
        </div>
      )}
    </div>
  );
}
