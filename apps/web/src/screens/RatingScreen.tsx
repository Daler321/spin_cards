import type {
  Currency,
  LeaderboardEntry,
  LeaderboardResponse,
  LeaderboardType,
} from '@spincards/shared';
import { AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLeaderboard, useMe, usePlayer } from '../api/queries';
import { PlayerProfileView } from '../components/PlayerProfileView';
import { Sheet } from '../components/Overlay';
import { formatMoney, LOCALE } from '../lib/format';
import { regionCurrency } from '../lib/money';
import { useNow } from '../lib/useNow';
import { ScrollStrip } from '../components/ScrollStrip';

const SEASON_BOARDS = ['season', 'balance', 'collection'] as const;
type SeasonBoard = (typeof SEASON_BOARDS)[number];

export default function RatingScreen() {
  const { t } = useTranslation('game');
  // Money and live cards reset with the season (D-132), so balance and collection are season
  // ratings next to the score; only the album of trophies lasts across seasons.
  const [scope, setScope] = useState<'season' | 'all'>('season');
  const [seasonType, setSeasonType] = useState<SeasonBoard>('season');
  const type: LeaderboardType = scope === 'season' ? seasonType : 'album';
  const [opened, setOpened] = useState<string | null>(null);
  const leaderboard = useLeaderboard(type);
  // Never render one board under the other tab.
  const board = leaderboard.data?.type === type ? leaderboard : { data: undefined };
  const me = useMe();
  const currency = me.data ? regionCurrency(me.data.region) : 'RUB';
  const score = (e: LeaderboardEntry) =>
    type === 'balance'
      ? formatMoney(e.score, 'RUB')
      : t(
          type === 'season'
            ? 'rating.seasonPoints'
            : type === 'album'
              ? 'rating.albumItems'
              : 'rating.points',
          { score: new Intl.NumberFormat(LOCALE).format(e.score) },
        );

  return (
    <div className="page">
      <div className="page-head">
        <h2>{t('rating.title')}</h2>
      </div>
      <div className="segmented segmented--wide" role="radiogroup" aria-label={t('rating.scope')}>
        {(['season', 'all'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={scope === id}
            className={scope === id ? 'is-active' : ''}
            onClick={() => {
              setScope(id);
            }}
          >
            {t(`rating.scopes.${id}`)}
          </button>
        ))}
      </div>
      {scope === 'season' && (
        <ScrollStrip className="chips" role="radiogroup">
          {SEASON_BOARDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={seasonType === id}
              className={`chip-button ${seasonType === id ? 'is-active' : 'chip-button--ghost'}`}
              onClick={() => {
                setSeasonType(id);
              }}
            >
              {t(id === 'season' ? 'rating.score' : `rating.${id}`)}
            </button>
          ))}
        </ScrollStrip>
      )}
      {scope === 'all' && <p className="hint">{t('rating.allTimeHint')}</p>}
      {type === 'season' && board.data?.season && (
        <SeasonInfo season={board.data.season} currency={currency} />
      )}

      {board.data && (
        <>
          <div className="my-place">
            {board.data.me && !board.data.top.some((e) => e.isMe) ? (
              <Row entry={board.data.me} score={score(board.data.me)} onOpen={setOpened} />
            ) : board.data.me ? null : (
              <p className="hint">
                {me.data?.settings.hideFromLeaderboard ? t('rating.hidden') : t('rating.notRanked')}
              </p>
            )}
          </div>
          {/* Ties share a rank and names repeat, so rows are keyed by position; one list per tab. */}
          <ol key={type} className="leaderboard">
            {board.data.top.map((entry, i) => (
              <li key={i}>
                <Row entry={entry} score={score(entry)} onOpen={setOpened} />
              </li>
            ))}
          </ol>
        </>
      )}
      <AnimatePresence>
        {opened && (
          <PlayerSheet
            userId={opened}
            onClose={() => {
              setOpened(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({
  entry,
  score,
  onOpen,
}: {
  entry: LeaderboardEntry;
  score: string;
  onOpen: (userId: string) => void;
}) {
  const { t } = useTranslation('game');
  return (
    // A block, not a <button>: Telegram's WebView sizes buttons to their content.
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        onOpen(entry.userId);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen(entry.userId);
      }}
      className={`lb-row ${entry.isMe ? 'is-me' : ''} ${entry.rank <= 3 ? `lb-row--top${String(entry.rank)}` : ''}`}
    >
      <span className="lb-rank">{entry.rank}</span>
      {entry.photoUrl ? (
        <img className="avatar avatar--small" src={entry.photoUrl} alt="" />
      ) : (
        <span className="avatar avatar--small avatar--initial">{entry.firstName.slice(0, 1)}</span>
      )}
      <span className="lb-name">
        {entry.isMe ? t('rating.you') : entry.firstName}
        <span className="hint"> · {t('header.level', { level: entry.level })}</span>
        {entry.medals.length > 0 && (
          <span className="lb-medals" aria-hidden="true">
            {entry.medals.join('')}
          </span>
        )}
      </span>
      <span className="lb-score">{score}</span>
    </div>
  );
}

/** A player's public profile: level, collection and their rarest cards. */
function PlayerSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
  const player = usePlayer(userId);
  const p = player.data;
  return (
    <Sheet onClose={onClose}>
      {!p ? <div className="screen-loading" aria-busy="true" /> : <PlayerProfileView p={p} />}
    </Sheet>
  );
}

/** The season header: when it ends and what the top of the rating gets (D-125). */
function SeasonInfo({
  season,
  currency,
}: {
  season: NonNullable<LeaderboardResponse['season']>;
  currency: Currency;
}) {
  const { t } = useTranslation('game');
  const now = useNow(60_000);
  const left = season.endsAt ? new Date(season.endsAt).getTime() - now : null;
  const brackets = [...season.medals].sort((a, b) => a.maxRank - b.maxRank);
  return (
    <div className="season-info">
      <div className="season-info-head">
        <strong>{season.name}</strong>
        {left !== null && left > 0 && (
          <span className="hint">
            {t('rating.seasonLeft', {
              days: Math.floor(left / 86_400_000),
              hours: Math.floor((left % 86_400_000) / 3_600_000),
            })}
          </span>
        )}
      </div>
      <ul className="season-rewards">
        {brackets.map((m, i) => {
          const from = i === 0 ? 1 : (brackets[i - 1]?.maxRank ?? 0) + 1;
          return (
            <li key={m.maxRank}>
              <span>
                {from === m.maxRank
                  ? t('rating.place', { rank: m.maxRank })
                  : t('rating.places', { from, to: m.maxRank })}
              </span>
              <b>
                {m.icon} {t(`achievements.${m.achievementId}.title`)}
              </b>
            </li>
          );
        })}
      </ul>
      <p className="hint">
        {t('rating.carryover', {
          perPoint: formatMoney(season.carryover.perPoint[currency], currency),
          cap: formatMoney(season.carryover.cap[currency], currency),
        })}
      </p>
    </div>
  );
}
