import type { CardView, MeResponse, PublicConfigResponse } from '@spincards/shared';
import { AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { haptics } from '../app/telegram';
import { formatCountdown } from '../lib/format';
import { multiplierText, previewLuck } from '../lib/luck';
import { useNow } from '../lib/useNow';
import { Sheet } from './Overlay';

/**
 * D-147: the luck of the next spin as a small chip at the top of the game screen; a tap opens the
 * details: the scale, what the paying card gives and the bonuses running now.
 */
export function LuckChip({
  me,
  config,
  payCard,
  packId,
  onShop,
}: {
  me: MeResponse;
  config: PublicConfigResponse;
  payCard: CardView | null;
  packId: string;
  /** Opens the shop (D-176: every purchase lives there). */
  onShop: () => void;
}) {
  const { t } = useTranslation('game');
  const [open, setOpen] = useState(false);
  const now = useNow(30_000);
  const max = config.luck.maxPoints;
  const luck = previewLuck(payCard?.luckPoints ?? 0, me.game.buffs, max, now, packId);
  return (
    <>
      <button
        type="button"
        className={`luck-chip ${luck.total > 0 ? 'is-on' : ''}`}
        aria-label={t('luck.open')}
        onClick={() => {
          haptics.impact('light');
          setOpen(true);
        }}
      >
        <span aria-hidden="true">🍀</span>
        {luck.total}
      </button>
      <AnimatePresence>
        {open && (
          <Sheet
            onClose={() => {
              setOpen(false);
            }}
          >
            <LuckDetails
              me={me}
              config={config}
              payCard={payCard}
              packId={packId}
              now={now}
              onShop={() => {
                setOpen(false);
                onShop();
              }}
            />
          </Sheet>
        )}
      </AnimatePresence>
    </>
  );
}

function LuckDetails({
  me,
  config,
  payCard,
  packId,
  now,
  onShop,
}: {
  me: MeResponse;
  config: PublicConfigResponse;
  payCard: CardView | null;
  packId: string;
  now: number;
  onShop: () => void;
}) {
  const { t } = useTranslation('game');
  const max = config.luck.maxPoints;
  const luck = previewLuck(payCard?.luckPoints ?? 0, me.game.buffs, max, now, packId);
  const tierPoints = payCard
    ? (config.tiers.find((x) => x.tier === payCard.tier)?.cardLuckPoints ?? 0)
    : 0;
  const running = me.game.buffs.filter((b) => {
    if (b.packId !== null && b.packId !== packId) return false;
    return b.spinsLeft === null
      ? b.expiresAt !== null && Date.parse(b.expiresAt) > now
      : b.spinsLeft > 0;
  });
  return (
    <div className="luck-details">
      <div className="luck-details-head">
        <span className="luck-details-icon" aria-hidden="true">
          🍀
        </span>
        <div>
          <h3>{t('luck.title')}</h3>
          <strong className="luck-details-value">
            {t('luck.value', { points: luck.total, max })}
          </strong>
        </div>
      </div>
      <div
        className="luck-line-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={luck.total}
      >
        <span
          className="luck-line-fill"
          style={{ width: `${String((luck.total / max) * 100)}%` }}
        />
      </div>
      <p className="hint">{t('luck.explain')}</p>

      <div className="list">
        <div className="list-row">
          <div className="list-main">
            <strong>
              {payCard ? t('luck.fromCard', { last4: payCard.number.slice(-4) }) : t('luck.wallet')}
            </strong>
            <span className="hint">
              {payCard
                ? t('luck.cardParts', {
                    tier: tierPoints,
                    number: Math.max(0, payCard.luckPoints - tierPoints),
                  })
                : t('luck.walletHint')}
            </span>
          </div>
          <strong>{luck.card}</strong>
        </div>
        {running.map((b, i) => (
          <div key={i} className="list-row">
            <div className="list-main">
              <strong>
                {b.multiplierBp !== null
                  ? t('luck.multiplier', { mult: multiplierText(b.multiplierBp) })
                  : t('luck.bonusRow')}
              </strong>
              <span className="hint">
                {b.spinsLeft !== null
                  ? t('luck.spinsLeft', { count: b.spinsLeft })
                  : t('luck.timeLeft', {
                      time: formatCountdown(Date.parse(b.expiresAt ?? '') - now),
                    })}
              </span>
            </div>
            <strong>
              {b.multiplierBp !== null
                ? multiplierText(b.multiplierBp)
                : `+${String(b.points ?? 0)}`}
            </strong>
          </div>
        ))}
      </div>

      <p className="hint">{t('luck.howTo')}</p>
      {config.stars && (
        <button type="button" className="button button--stars" onClick={onShop}>
          {t('luck.shop')}
        </button>
      )}
    </div>
  );
}
