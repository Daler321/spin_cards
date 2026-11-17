import type {
  CardView,
  Currency,
  HolderView,
  MeResponse,
  PublicConfigResponse,
} from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import {
  useBuyHolder,
  useHolder,
  useMe,
  usePublicConfig,
  useSeasonCollection,
} from '../api/queries';
import { haptics } from '../app/telegram';
import { Card } from '../components/card/Card';
import { errorText } from '../lib/errors';
import { formatCountdown, formatMoney, formatTime } from '../lib/format';
import { arrangeCards, type HolderCurrency, type HolderSort } from '../lib/holderSort';
import { regionCurrency } from '../lib/money';
import { useNow } from '../lib/useNow';
import { useNavigation } from '../state/navigation';
import { useSelection } from '../state/selection';
import { useToast } from '../state/toast';
import { useWalletGuard } from '../lib/useWalletGuard';
import { StarsButton } from '../components/StarsButton';

export default function HolderScreen() {
  const { t } = useTranslation('game');
  const me = useMe();
  const holder = useHolder();
  const config = usePublicConfig();
  const open = useNavigation((s) => s.open);
  const setTab = useNavigation((s) => s.setTab);
  const { holderSort, holderCurrency, setHolderSort, setHolderCurrency } = useSelection();
  if (!me.data || !holder.data || !config.data)
    return <div className="screen-loading" aria-busy="true" />;
  const { cards, pending, slots } = holder.data;
  const bankName = (id: string) => config.data.banks.find((b) => b.id === id)?.name;
  const shown = arrangeCards(cards, holderSort, holderCurrency, config.data.conversion.rates);

  return (
    <div className="page">
      <div className="page-head">
        <h2>{t('holder.title')}</h2>
        <span className="chip">{t('holder.slots', { used: slots.used, total: slots.total })}</span>
        <button
          type="button"
          className="chip-button chip-button--ghost"
          onClick={() => {
            open({ name: 'album' });
          }}
        >
          {t('album.open')}
        </button>
      </div>
      <SeasonProgress
        onOpen={() => {
          open({ name: 'seasonCollection' });
        }}
      />
      <Collection collection={holder.data.collection} />

      {pending.length > 0 && (
        <button
          type="button"
          className="banner"
          onClick={() => {
            setTab('game');
          }}
        >
          <span>{t('holder.pending')}</span>
          <strong>{t('holder.pendingAction')}</strong>
        </button>
      )}

      {cards.length === 0 ? (
        <p className="empty">{t('holder.empty')}</p>
      ) : (
        <>
          <Fan cards={cards} holderName={me.data.firstName} />
          <SortBar
            sort={holderSort}
            currency={holderCurrency}
            onSort={setHolderSort}
            onCurrency={setHolderCurrency}
          />
          {shown.length === 0 && <p className="empty">{t('holder.noneInCurrency')}</p>}
          <div className="card-grid">
            {shown.map((card) => (
              <button
                key={card.id}
                type="button"
                className="card-tile"
                onClick={() => {
                  haptics.select();
                  open({ name: 'card', cardId: card.id });
                }}
              >
                <Card
                  card={card}
                  holderName={me.data.firstName}
                  {...(bankName(card.bankId) && { bankName: bankName(card.bankId) })}
                  animated={false}
                  className="gc--fluid"
                />
                <LifeLine card={card} />
                {card.status === 'active' && <SpinLimitLine card={card} />}
              </button>
            ))}
          </div>
        </>
      )}

      <HolderShop me={me.data} config={config.data} />
    </div>
  );
}

function SortBar({
  sort,
  currency,
  onSort,
  onCurrency,
}: {
  sort: HolderSort;
  currency: HolderCurrency;
  onSort: (sort: HolderSort) => void;
  onCurrency: (currency: HolderCurrency) => void;
}) {
  const { t } = useTranslation('game');
  return (
    <div className="sort-bar">
      <div className="segmented" role="radiogroup" aria-label={t('holder.currencyLabel')}>
        {(['all', 'RUB', 'USD'] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={currency === c}
            className={currency === c ? 'is-active' : ''}
            onClick={() => {
              haptics.select();
              onCurrency(c);
            }}
          >
            {t(`holder.currency.${c}`)}
          </button>
        ))}
      </div>
      <div className="segmented" role="radiogroup" aria-label={t('holder.sortLabel')}>
        {(['rarity', 'balance', 'time'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={sort === s}
            className={sort === s ? 'is-active' : ''}
            onClick={() => {
              haptics.select();
              onSort(s);
            }}
          >
            {t(`holder.sort.${s}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

function Collection({ collection }: { collection: HolderView['collection'] }) {
  const { t } = useTranslation('game');
  const progress =
    collection.nextLevelScore === null ? 1 : collection.score / collection.nextLevelScore;
  return (
    <div className="collection">
      <strong>{t('holder.collection', { level: collection.level })}</strong>
      <span className="progress">
        <span
          className="progress-fill"
          style={{ width: `${String(Math.min(100, progress * 100))}%` }}
        />
      </span>
      <span className="hint">
        {collection.nextLevelScore === null
          ? t('holder.collectionMax', { score: collection.score })
          : t('holder.collectionScore', {
              score: collection.score,
              next: collection.nextLevelScore,
            })}
      </span>
    </div>
  );
}

/** A fan of the five most valuable cards (TZ 13 "веер карт"). */
function Fan({ cards, holderName }: { cards: CardView[]; holderName: string }) {
  const top = [...cards]
    .sort((a, b) => b.rarityScore - a.rarityScore || b.balance - a.balance)
    .slice(0, 5);
  const mid = (top.length - 1) / 2;
  return (
    <div className="fan" aria-hidden="true">
      {top.map((card, i) => (
        <div
          key={card.id}
          className="fan-card"
          style={{
            transform: `translateX(${String((i - mid) * 34)}px) rotate(${String((i - mid) * 7)}deg)`,
            zIndex: i,
          }}
        >
          <Card card={card} holderName={holderName} showBalance={false} animated={false} />
        </div>
      ))}
    </div>
  );
}

/** The countdown ticks by itself: the screen around it does not re-render every second. */
export function LifeLine({ card }: { card: CardView }) {
  const { t } = useTranslation('game');
  const now = useNow();
  const expired = card.status === 'expired' || Date.parse(card.expiresAt) <= now;
  if (expired) {
    const until = card.graceUntil ? Date.parse(card.graceUntil) : Date.parse(card.expiresAt);
    return (
      <span className="life life--expired">
        {t('holder.burnsIn', { time: formatCountdown(until - now) })}
      </span>
    );
  }
  return (
    <span className="life">
      {t('holder.expiresIn', { time: formatCountdown(Date.parse(card.expiresAt) - now) })}
    </span>
  );
}

function HolderShop({ me, config }: { me: MeResponse; config: PublicConfigResponse }) {
  const { t } = useTranslation(['game', 'shop']);
  const toast = useToast((s) => s.show);
  const buy = useBuyHolder();
  const { guard } = useWalletGuard();
  const owned = useHolder().data?.ownedHolders ?? [];
  const currency: Currency = regionCurrency(me.region);

  return (
    <section className="section">
      <h3>{t('holder.buyTitle')}</h3>
      <div className="list">
        {config.holders
          .filter((h) => Object.keys(h.prices).length > 0)
          .map((holder) => {
            const isOwned = owned.includes(holder.id);
            const locked = me.level < holder.unlockLevel;
            const price = holder.prices[currency];
            return (
              <div key={holder.id} className="list-row">
                <div className="list-main">
                  <strong>{t(`shop:holders.${holder.id}`, { defaultValue: holder.id })}</strong>
                  <span className="hint">{t('holder.slotsPlus', { slots: holder.slots })}</span>
                </div>
                {!isOwned && holder.starsPrice !== null && (
                  // D-146: for Stars at once, whatever the level.
                  <StarsButton productId={`holder:${holder.id}`} stars={holder.starsPrice} />
                )}
                {isOwned ? (
                  <span className="chip chip--ok">{t('holder.owned')}</span>
                ) : locked ? (
                  <span className="chip">{t('holder.unlock', { level: holder.unlockLevel })}</span>
                ) : (
                  price !== undefined && (
                    <button
                      type="button"
                      className="button button--small button--primary"
                      disabled={buy.isPending}
                      onClick={() => {
                        if (!guard(currency, price)) return;
                        buy.mutate(
                          { holderId: holder.id, payWith: currency },
                          {
                            onSuccess: (res) => {
                              haptics.notify('success');
                              toast(t('shop:holderBought', { slots: res.slotsTotal }), 'success');
                            },
                            onError: (e) => {
                              haptics.notify('error');
                              toast(errorText(t, e), 'error');
                            },
                          },
                        );
                      }}
                    >
                      {formatMoney(price, currency)}
                    </button>
                  )
                )}
              </div>
            );
          })}
      </div>
    </section>
  );
}

/** D-121: spins this card can still pay for in its window. */
function SpinLimitLine({ card }: { card: CardView }) {
  const { t } = useTranslation('game');
  const { left, max, resetsAt } = card.spinLimit;
  return (
    <span className={`spin-limit ${left === 0 ? 'is-out' : ''}`}>
      {left === 0 && resetsAt
        ? t('holder.spinLimitOut', { time: formatTime(resetsAt) })
        : t('holder.spinLimit', { left, max })}
    </span>
  );
}

/** D-130: how much of the season's collection the player has dropped; opens the full grid. */
function SeasonProgress({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation('game');
  const collection = useSeasonCollection();
  const data = collection.data;
  if (!data) return null;
  return (
    <button type="button" className="season-progress" onClick={onOpen}>
      <span className="section-label">
        {t('seasonCollection.progress', { collected: data.collected, total: data.total })}
      </span>
      <span
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
      </span>
    </button>
  );
}
