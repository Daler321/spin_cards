import {
  type CardView,
  type CraftResponse,
  isUpgradeTier,
  nextTier,
  type Tier,
  UPGRADE_TIERS,
} from '@spincards/shared';
import { type CSSProperties, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCraft, useHolder, useMe, usePublicConfig } from '../api/queries';
import { haptics } from '../app/telegram';
import { Card } from '../components/card/Card';
import { OverlayScreen } from '../components/Overlay';
import { errorText } from '../lib/errors';
import { formatMoney, formatPercentBp } from '../lib/format';
import { regionCurrency } from '../lib/money';
import { useNow } from '../lib/useNow';
import { useToast } from '../state/toast';

/**
 * D-170: pick N held cards of one tier; the server rolls the published chance and answers with the
 * new card, which is shown only after the answer.
 */
export default function CraftScreen() {
  const { t } = useTranslation(['game', 'shop']);
  const me = useMe();
  const config = usePublicConfig();
  const holder = useHolder();
  const craft = useCraft();
  const toast = useToast((s) => s.show);
  const now = useNow(30_000);
  const [picked, setPicked] = useState<string[]>([]);
  const [result, setResult] = useState<CraftResponse | null>(null);
  const rules = config.data?.craft;
  if (!me.data || !config.data || !holder.data)
    return (
      <OverlayScreen title={t('craft.title')}>
        <div className="screen-loading" aria-busy="true" />
      </OverlayScreen>
    );
  if (!rules)
    return (
      <OverlayScreen title={t('craft.title')}>
        <p className="hint">{t('craft.closed')}</p>
      </OverlayScreen>
    );
  const currency = regionCurrency(me.data.region);
  const usable = holder.data.cards.filter(
    (c) =>
      c.status === 'active' &&
      c.currency === currency &&
      Date.parse(c.expiresAt) > now &&
      isUpgradeTier(c.tier),
  );
  const byTier = (tier: Tier) => usable.filter((c) => c.tier === tier);
  const chosen = usable.filter((c) => picked.includes(c.id));
  const tier = chosen[0]?.tier;
  const ready = chosen.length === rules.cards && tier !== undefined && isUpgradeTier(tier);
  const fee = tier && isUpgradeTier(tier) ? rules.fee[tier][currency] : 0;

  const toggle = (card: CardView) => {
    haptics.select();
    setResult(null);
    setPicked((list) => {
      if (list.includes(card.id)) return list.filter((id) => id !== card.id);
      // A card of another tier starts a new selection.
      const same = list.filter((id) => usable.find((c) => c.id === id)?.tier === card.tier);
      return same.length >= rules.cards ? same : [...same, card.id];
    });
  };

  return (
    <OverlayScreen title={t('craft.title')}>
      <p className="hint">{t('craft.hint', { count: rules.cards })}</p>
      <section className="section">
        <h3>{t('craft.odds')}</h3>
        <ul className="season-rewards">
          {UPGRADE_TIERS.map((from) => (
            <li key={from}>
              <span>
                {t('craft.oddsRow', {
                  from: t(`tiers.${from}`),
                  to: t(`tiers.${nextTier(from) ?? from}`),
                  chance: formatPercentBp(rules.successBp[from]),
                })}
              </span>
              <b>{formatMoney(rules.fee[from][currency], currency)}</b>
            </li>
          ))}
        </ul>
      </section>

      {result && (
        <section className="section craft-result">
          <h3>
            {t(result.success ? 'craft.success' : 'craft.fail', {
              tier: t(`tiers.${result.card.tier}`),
            })}
          </h3>
          {/* A sized card (not gc--fluid: that one needs a grid tile to size its text). */}
          <Card
            card={result.card}
            holderName={me.data.firstName}
            style={{ '--card-width': 'min(88vw, 340px)' } as CSSProperties}
          />
        </section>
      )}

      {UPGRADE_TIERS.every((x) => byTier(x).length < rules.cards) ? (
        <p className="empty">{t('craft.noCards', { count: rules.cards })}</p>
      ) : (
        <section className="section">
          <h3>{t('craft.pick', { selected: chosen.length, count: rules.cards })}</h3>
          {UPGRADE_TIERS.filter((x) => byTier(x).length >= rules.cards).map((x) => (
            <div key={x}>
              <span className="section-label">{t(`tiers.${x}`)}</span>
              <div className="card-grid">
                {byTier(x).map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    className={`card-tile ${picked.includes(card.id) ? 'is-active' : ''}`}
                    aria-pressed={picked.includes(card.id)}
                    onClick={() => {
                      toggle(card);
                    }}
                  >
                    <Card
                      card={card}
                      holderName={me.data.firstName}
                      animated={false}
                      className="gc--fluid"
                    />
                  </button>
                ))}
              </div>
            </div>
          ))}
          {tier && isUpgradeTier(tier) && (
            <p className="hint">
              {t('craft.chance', {
                tier: t(`tiers.${nextTier(tier) ?? tier}`),
                chance: formatPercentBp(rules.successBp[tier]),
              })}{' '}
              · {t('craft.fee', { fee: formatMoney(fee, currency) })}
            </p>
          )}
          <button
            type="button"
            className="button button--primary"
            disabled={!ready || craft.isPending}
            onClick={() => {
              haptics.impact('heavy');
              craft.mutate(
                { cardIds: picked },
                {
                  onSuccess: (res) => {
                    haptics.notify(res.success ? 'success' : 'warning');
                    setPicked([]);
                    setResult(res);
                  },
                  onError: (e) => {
                    haptics.notify('error');
                    toast(errorText(t, e), 'error');
                  },
                },
              );
            }}
          >
            {t('craft.go')}
          </button>
        </section>
      )}
    </OverlayScreen>
  );
}
