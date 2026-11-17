import type { MeResponse, PublicConfigResponse } from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { useHolder } from '../api/queries';
import { formatMoney } from '../lib/format';
import { spinSetup } from '../lib/spinSetup';
import { useNow } from '../lib/useNow';
import { useNavigation } from '../state/navigation';
import { useSelection } from '../state/selection';
import { AutoSellButton } from './AutoSellButton';
import { LevelInfo } from './LevelInfo';
import { LuckChip } from './LuckChip';

export function Header({ me, config }: { me: MeResponse; config: PublicConfigResponse }) {
  const { t } = useTranslation('game');
  const open = useNavigation((s) => s.open);
  const setTab = useNavigation((s) => s.setTab);
  const holder = useHolder();
  const now = useNow(30_000);
  const selection = useSelection();
  // The balance of whatever pays for the next spin: the wallet or the picked card.
  const { currency, pack, payCard } = spinSetup(
    me,
    config,
    holder.data?.cards ?? [],
    selection,
    now,
  );
  // D-177: everything the player has (wallet and cards), one amount per currency.
  const totals = me.wallets
    .map((w) => ({
      currency: w.currency,
      amount:
        w.balance +
        (holder.data?.cards ?? [])
          .filter((c) => c.currency === w.currency && c.status !== 'pooled')
          .reduce((sum, c) => sum + c.balance, 0),
    }))
    .filter((x) => x.amount > 0 || x.currency === currency);
  // One gift for everything waiting in «Бонусы» (the chest has its own chip on the game screen).
  const bonusWaiting =
    !me.game.daily.claimedToday ||
    me.game.wheel.availableAt === null ||
    Date.parse(me.game.wheel.availableAt) <= now;
  const giftsWaiting = bonusWaiting || me.game.questsReady > 0;
  const tab = useNavigation((s) => s.tab);

  return (
    <header className="header">
      {/* D-178: in «Ещё» the level moves down, above the search (MoreScreen). */}
      <div className="header-player">
        {tab !== 'more' && (
          <>
            {me.photoUrl ? (
              <img className="avatar" src={me.photoUrl} alt="" />
            ) : (
              <span className="avatar avatar--initial">
                {me.firstName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <LevelInfo me={me} config={config} />
          </>
        )}
      </div>

      <div className="header-balance">
        <span className="header-balance-label">{t('header.total')}</span>
        {totals.map((x) => (
          <span key={x.currency} className="header-balance-value">
            {formatMoney(x.amount, x.currency)}
          </span>
        ))}
      </div>

      <div className="header-actions">
        {giftsWaiting && (
          <button
            type="button"
            className="icon-button daily-button"
            onClick={() => {
              setTab('bonuses');
              // Only finished quests wait: open them right away.
              if (!bonusWaiting) open({ name: 'quests' });
            }}
            aria-label={t('header.gifts')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            </svg>
          </button>
        )}
        <div className="header-luck">
          <LuckChip
            me={me}
            config={config}
            payCard={payCard ?? null}
            packId={pack?.id ?? ''}
            onShop={() => {
              open({ name: 'shop' });
            }}
          />
          {/* D-178: auto-sell right under the clover on the main screen. */}
          {tab === 'game' && <AutoSellButton me={me} />}
        </div>
      </div>
    </header>
  );
}
