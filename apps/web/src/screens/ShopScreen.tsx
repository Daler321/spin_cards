import {
  type Currency,
  isUpgradeTier,
  nextTier,
  type PublicConfigResponse,
} from '@spincards/shared';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHolder, useMe, usePublicConfig, useShopBuy } from '../api/queries';
import { haptics } from '../app/telegram';
import { OverlayScreen } from '../components/Overlay';
import { StarsButton } from '../components/StarsButton';
import { errorText } from '../lib/errors';
import { formatMoney } from '../lib/format';
import { multiplierText } from '../lib/luck';
import { regionCurrency } from '../lib/money';
import { useNow } from '../lib/useNow';
import { useWalletGuard } from '../lib/useWalletGuard';
import { useToast } from '../state/toast';

const row = (key: string, title: ReactNode, button: ReactNode, hint?: string) => (
  <div key={key} className="list-row">
    <div className="list-main">
      <strong>{title}</strong>
      {hint && <span className="hint">{hint}</span>}
    </div>
    {button}
  </div>
);

/** Everything for sale in one place, by kind: Stars products first, then game-money bundles. */
export default function ShopScreen({ cardId }: { cardId?: string }) {
  const { t } = useTranslation(['shop', 'game']);
  const me = useMe();
  const config = usePublicConfig();
  if (!me.data || !config.data)
    return (
      <OverlayScreen title={t('shopScreen.title')}>
        <div className="screen-loading" aria-busy="true" />
      </OverlayScreen>
    );
  const currency = regionCurrency(me.data.region);
  const stars = config.data.stars;
  const chestNext = config.data.chest.levels.find((l) => l.level === me.data.game.chest.level + 1);
  return (
    <OverlayScreen title={t('shopScreen.title')}>
      {!stars && <p className="hint">{t('shopScreen.starsOff')}</p>}
      {stars && (
        <>
          <section className="section">
            <h3>{t('shopScreen.luck')}</h3>
            <p className="hint">{t('stars.hint', { max: config.data.luck.maxPoints })}</p>
            <div className="list">
              {stars.buffs.map((buff) =>
                row(
                  `buff:${buff.id}`,
                  t('stars.buff', {
                    mult: multiplierText(buff.multiplierBp),
                    minutes: buff.minutes,
                  }),
                  <StarsButton productId={`buff:${buff.id}`} stars={buff.stars} />,
                ),
              )}
            </div>
          </section>
          <section className="section">
            <h3>{t('shopScreen.spins')}</h3>
            <div className="list">
              {stars.freeSpins.map((offer) =>
                row(
                  `free_spins:${offer.id}`,
                  t('stars.freeSpins', { count: offer.count }),
                  <StarsButton productId={`free_spins:${offer.id}`} stars={offer.stars} />,
                ),
              )}
            </div>
          </section>
          <section className="section">
            <h3>{t('shopScreen.wheelChest')}</h3>
            <div className="list">
              {row(
                'wheel_now',
                t('bonuses.wheelNow'),
                <StarsButton
                  productId="wheel_now"
                  stars={stars.wheelNow}
                  disabled={me.data.game.wheel.availableAt === null}
                />,
              )}
              {chestNext?.upgradeStarsPrice != null
                ? row(
                    'chest_upgrade',
                    t('bonuses.chestUpgradeStars', { level: chestNext.level }),
                    <StarsButton productId="chest_upgrade" stars={chestNext.upgradeStarsPrice} />,
                  )
                : row('chest_max', t('shopScreen.chestMax'), null)}
            </div>
          </section>
          <section className="section">
            <h3>{t('shopScreen.places')}</h3>
            <div className="list">
              {config.data.holders
                .filter((h) => h.starsPrice !== null)
                .map((h) =>
                  row(
                    `holder:${h.id}`,
                    t(`holders.${h.id}`, { defaultValue: h.id }),
                    <StarsButton productId={`holder:${h.id}`} stars={h.starsPrice ?? 0} />,
                    t('shopScreen.holder', { slots: h.slots }),
                  ),
                )}
              {row(
                'album_slot',
                t('stars.albumSlot'),
                <StarsButton productId="album_slot" stars={stars.albumSlot} />,
              )}
            </div>
          </section>
          <CardProducts config={config.data} currency={currency} initialCardId={cardId} />
        </>
      )}
      <CoinShop config={config.data} currency={currency} />
    </OverlayScreen>
  );
}

/** Stars products for one card: upgrade (D-171), extension, spin limit reset, album. */
function CardProducts({
  config,
  currency,
  initialCardId,
}: {
  config: PublicConfigResponse;
  currency: Currency;
  initialCardId: string | undefined;
}) {
  const { t } = useTranslation(['shop', 'game']);
  const holder = useHolder();
  const now = useNow(30_000);
  const [picked, setPicked] = useState<string | null>(initialCardId ?? null);
  const stars = config.stars;
  if (!stars) return null;
  const cards = (holder.data?.cards ?? []).filter(
    (c) => c.status === 'active' && Date.parse(c.expiresAt) > now,
  );
  const card = cards.find((c) => c.id === picked) ?? cards[0];
  const up = card ? nextTier(card.tier) : null;
  return (
    <section className="section">
      <h3>{t('shopScreen.cards')}</h3>
      {!card ? (
        <p className="hint">{t('shopScreen.noCards')}</p>
      ) : (
        <>
          <span className="section-label">{t('shopScreen.pickCard')}</span>
          <div
            className="pay-list topup-cards"
            role="radiogroup"
            aria-label={t('shopScreen.pickCard')}
          >
            {cards.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={card.id === c.id}
                className={`pay-row ${card.id === c.id ? 'is-active' : ''}`}
                onClick={() => {
                  haptics.select();
                  setPicked(c.id);
                }}
              >
                <span className={`pay-dot pay-dot--${c.tier}`} aria-hidden="true" />
                <span className="pay-row-main">
                  <b>{t('game:transfer.card', { last4: c.number.slice(-4) })}</b>
                  <span className="hint">{t(`game:tiers.${c.tier}`)}</span>
                </span>
                <span className="pay-row-side">
                  <b>{formatMoney(c.balance, currency)}</b>
                </span>
              </button>
            ))}
          </div>
          <div className="list">
            {stars.cardUpgrade &&
              up &&
              isUpgradeTier(card.tier) &&
              row(
                'card_upgrade',
                t('game:cardStars.upgrade', { tier: t(`game:tiers.${up}`) }),
                <StarsButton
                  productId="card_upgrade"
                  cardId={card.id}
                  stars={stars.cardUpgrade[card.tier]}
                />,
              )}
            {card.extendedCount > 0 &&
              row(
                'card_extend',
                t('game:cardStars.extend'),
                <StarsButton
                  productId="card_extend"
                  cardId={card.id}
                  stars={stars.cardExtend[card.tier]}
                />,
              )}
            {card.spinLimit.left < card.spinLimit.max &&
              row(
                'card_limit_reset',
                t('game:cardStars.reset'),
                <StarsButton
                  productId="card_limit_reset"
                  cardId={card.id}
                  stars={stars.cardLimitReset}
                />,
              )}
            {row(
              'trophy',
              t('game:cardStars.trophy'),
              <StarsButton productId="trophy" cardId={card.id} stars={stars.trophy[card.tier]} />,
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** Free spin bundles for game money (D-147: luck is not sold for game money). */
function CoinShop({ config, currency }: { config: PublicConfigResponse; currency: Currency }) {
  const { t } = useTranslation(['shop', 'game']);
  const toast = useToast((s) => s.show);
  const buy = useShopBuy();
  const { guard } = useWalletGuard();
  const items = config.shop.items.filter((item) => item.prices[currency] !== undefined);
  if (items.length === 0) return null;
  return (
    <section className="section">
      <h3>{t('shopScreen.coins')}</h3>
      <div className="list">
        {items.map((item) =>
          row(
            item.id,
            t(`items.${item.id}`, { defaultValue: item.id }),
            <button
              type="button"
              className="button button--small button--primary"
              disabled={buy.isPending}
              onClick={() => {
                if (!guard(currency, item.prices[currency] ?? 0)) return;
                buy.mutate(
                  { itemId: item.id, currency },
                  {
                    onSuccess: () => {
                      haptics.notify('success');
                      toast(t('bought'), 'success');
                    },
                    onError: (e) => {
                      haptics.notify('error');
                      toast(errorText(t, e), 'error');
                    },
                  },
                );
              }}
            >
              {formatMoney(item.prices[currency] ?? 0, currency)}
            </button>,
          ),
        )}
      </div>
    </section>
  );
}
