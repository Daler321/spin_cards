import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe, usePublicConfig } from '../api/queries';
import { haptics, openTelegramLink } from '../app/telegram';
import { LevelInfo } from '../components/LevelInfo';
import { useNow } from '../lib/useNow';
import { type Overlay, type Tab, useNavigation } from '../state/navigation';

interface Tile {
  id: string;
  icon: string;
  title: string;
  hint: string;
  badge?: string | false;
  go: { tab: Tab } | { overlay: Overlay } | { link: string };
}

/**
 * D-177: everything that is not a main tab, as labelled tiles in order of importance (the most used
 * first), shortcuts to the tabs included, and a search over all of them.
 */
export default function MoreScreen() {
  const { t } = useTranslation(['common', 'game']);
  const setTab = useNavigation((s) => s.setTab);
  const open = useNavigation((s) => s.open);
  const me = useMe();
  const config = usePublicConfig();
  const now = useNow(30_000);
  const [query, setQuery] = useState('');
  const game = me.data?.game;
  const wheelAt = game?.wheel.availableAt;
  const wheelReady = wheelAt === null || (wheelAt !== undefined && Date.parse(wheelAt) <= now);
  const income = game?.albumIncome;
  const incomeReady =
    !!income &&
    income.trophies > 0 &&
    (income.availableAt === null || Date.parse(income.availableAt) <= now);
  const nick = game?.nickBonus;
  const nickReady =
    !!nick && nick.hasTag && (nick.availableAt === null || Date.parse(nick.availableAt) <= now);
  const bot = config.data?.botUsername;
  const news = config.data?.newsUrl;
  const overlay = (o: Overlay) => ({ overlay: o });

  const sections: { id: string; tiles: Tile[] }[] = [
    {
      id: 'main',
      tiles: [
        {
          id: 'donate',
          icon: '⭐',
          title: t('more.donate'),
          hint: t('more.donateHint'),
          go: overlay({ name: 'shop' }),
        },
        {
          id: 'wheel',
          icon: '🎡',
          title: t('more.wheel'),
          hint: t('more.wheelHint', { hours: config.data?.wheel.intervalHours ?? 0 }),
          badge: wheelReady && t('more.wheelReady'),
          go: overlay({ name: 'wheel' }),
        },
        {
          id: 'games',
          icon: '🎲',
          title: t('more.games'),
          hint: t('more.gamesTile'),
          go: overlay({ name: 'minigames' }),
        },
        {
          id: 'quests',
          icon: '📜',
          title: t('more.quests'),
          hint: t('more.questsHint'),
          badge: (game?.questsReady ?? 0) > 0 && String(game?.questsReady),
          go: overlay({ name: 'quests' }),
        },
        {
          id: 'holder',
          icon: '💳',
          title: t('more.holder'),
          hint: t('more.holderHint'),
          go: { tab: 'holder' },
        },
        {
          id: 'wallet',
          icon: '👛',
          title: t('more.wallet'),
          hint: t('more.walletHint'),
          go: { tab: 'wallet' },
        },
      ],
    },
    {
      id: 'play',
      tiles: [
        ...(config.data?.craft
          ? [
              {
                id: 'craft',
                icon: '⚒',
                title: t('more.craft'),
                hint: t('more.craftHint', { count: config.data.craft.cards }),
                go: overlay({ name: 'craft' }),
              } satisfies Tile,
            ]
          : []),
        {
          id: 'album',
          icon: '🏆',
          title: t('more.album'),
          hint: t('more.albumHint'),
          badge: incomeReady && t('more.albumIncomeReady'),
          go: overlay({ name: 'album' }),
        },
        {
          id: 'collection',
          icon: '🗂',
          title: t('more.collection'),
          hint: t('more.collectionHint'),
          go: overlay({ name: 'seasonCollection' }),
        },
        {
          id: 'bonuses',
          icon: '🎁',
          title: t('more.bonuses'),
          hint: t('more.bonusesHint'),
          go: { tab: 'bonuses' },
        },
        {
          id: 'rating',
          icon: '📈',
          title: t('more.rating'),
          hint: t('more.ratingHint'),
          go: { tab: 'rating' },
        },
      ],
    },
    {
      id: 'social',
      tiles: [
        {
          id: 'referrals',
          icon: '🤝',
          title: t('more.referrals'),
          hint: t('more.referralsHint'),
          go: overlay({ name: 'referrals' }),
        },
        ...(config.data?.nickBonus
          ? [
              {
                id: 'nick',
                icon: '🏷',
                title: t('more.nick'),
                hint: t('more.nickHint', { tag: config.data.nickBonus.tag }),
                badge: nickReady && t('more.wheelReady'),
                go: overlay({ name: 'nickBonus' }),
              } satisfies Tile,
            ]
          : []),
        {
          id: 'medals',
          icon: '🏅',
          title: t('more.medals'),
          hint: t('more.medalsHint'),
          go: overlay({ name: 'medals' }),
        },
        {
          id: 'playerSearch',
          icon: '🔎',
          title: t('more.playerSearch'),
          hint: t('more.playerSearchHint'),
          go: overlay({ name: 'playerSearch' }),
        },
        {
          id: 'profile',
          icon: '👤',
          title: t('more.profile'),
          hint: t('more.profileHint'),
          go: overlay({ name: 'profile' }),
        },
      ],
    },
    {
      id: 'info',
      tiles: [
        {
          id: 'seasons',
          icon: '🗓',
          title: t('more.seasons'),
          hint: t('more.seasonsHint'),
          go: overlay({ name: 'seasons' }),
        },
        ...(news
          ? [
              {
                id: 'news',
                icon: '📰',
                title: t('more.news'),
                hint: t('more.newsHint'),
                go: { link: news },
              } satisfies Tile,
            ]
          : []),
        {
          id: 'rules',
          icon: '📖',
          title: t('more.rules'),
          hint: t('more.rulesHint'),
          go: overlay({ name: 'rules' }),
        },
        {
          id: 'odds',
          icon: '🎯',
          title: t('more.odds'),
          hint: t('more.oddsHint'),
          go: overlay({ name: 'odds' }),
        },
        ...(bot
          ? [
              {
                id: 'support',
                icon: '💬',
                title: t('more.support'),
                hint: t('more.supportHint'),
                go: { link: `https://t.me/${bot}?start=support` },
              } satisfies Tile,
            ]
          : []),
      ],
    },
  ];

  const go = (tile: Tile) => {
    haptics.select();
    if ('tab' in tile.go) setTab(tile.go.tab);
    else if ('overlay' in tile.go) open(tile.go.overlay);
    else openTelegramLink(tile.go.link);
  };
  const tiles = (list: Tile[]) => (
    <div className="game-tiles more-tiles">
      {list.map((tile) => (
        <button
          key={tile.id}
          type="button"
          className="game-tile more-tile"
          onClick={() => {
            go(tile);
          }}
        >
          <span className="more-tile-icon" aria-hidden="true">
            {tile.icon}
          </span>
          <strong>{tile.title}</strong>
          <span className="hint">{tile.hint}</span>
          {tile.badge && <span className="more-tile-badge">{tile.badge}</span>}
        </button>
      ))}
    </div>
  );
  const q = query.trim().toLowerCase();
  const found = q
    ? sections
        .flatMap((s) => s.tiles)
        .filter((tile) => `${tile.title} ${tile.hint}`.toLowerCase().includes(q))
    : [];

  return (
    <div className="page">
      <div className="page-head">
        <h2>{t('more.title')}</h2>
      </div>
      {/* D-178: the level lives here in «Ещё» (the header hides it): information, not a button. */}
      {me.data && config.data && (
        <LevelInfo me={me.data} config={config.data} className="header-level more-level" />
      )}
      <input
        className="input more-search"
        type="search"
        placeholder={t('more.search')}
        aria-label={t('more.search')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
      />
      {q ? (
        found.length > 0 ? (
          <section className="section">{tiles(found)}</section>
        ) : (
          <p className="empty">{t('more.nothingFound')}</p>
        )
      ) : (
        sections.map((s) => (
          <section key={s.id} className="section">
            <h3>{t(`more.sections.${s.id}`)}</h3>
            {tiles(s.tiles)}
          </section>
        ))
      )}
    </div>
  );
}
