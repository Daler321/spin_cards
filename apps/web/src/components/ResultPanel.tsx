import type { CardView, NearMissView, SpinItem } from '@spincards/shared';
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react';
import { type CSSProperties, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../lib/format';
import { useTilt } from '../lib/useTilt';
import { Card } from './card/Card';
import { CardViewer } from './CardViewer';

const FLASH: Record<string, string> = {
  common: 'rgb(200 200 210 / 0.5)',
  rare: 'rgb(0 229 255 / 0.65)',
  epic: 'rgb(255 205 80 / 0.75)',
  legendary: 'rgb(235 240 255 / 0.85)',
  mythic: 'rgb(200 90 255 / 0.85)',
};

export type Decision = 'toCard' | 'toWallet' | 'hold';

interface ResultPanelProps {
  /** Dropped cards still waiting for a decision. */
  cards: CardView[];
  /** Spin details (badges, near miss) when the cards come from a spin just made. */
  items?: SpinItem[];
  expGained?: number;
  leveledUpTo?: number | null;
  /** The held card that paid for the spin: its payout target is the primary action. */
  payCard: CardView | null;
  holderName: string;
  bankName: (bankId: string) => string | undefined;
  /** For the share link of the card viewer. */
  referralCode: string;
  /** A new player: the two choices get a short explanation. */
  beginner: boolean;
  onDecide: (cardId: string, decision: Decision) => void;
  onDecideAll: (decision: Decision) => void;
  busy: boolean;
}

export function ResultPanel(props: ResultPanelProps) {
  const [viewing, setViewing] = useState<CardView | null>(null);
  return (
    <>
      {props.cards.length === 1 && props.cards[0] ? (
        <Single card={props.cards[0]} {...props} onOpen={setViewing} />
      ) : (
        <Many {...props} onOpen={setViewing} />
      )}
      {/* A tap on a dropped card opens it up close (D-114); a portal keeps it full-screen. */}
      {createPortal(
        <AnimatePresence>
          {viewing && (
            <CardViewer
              card={viewing}
              holderName={props.holderName}
              bankName={props.bankName(viewing.bankId)}
              referralCode={props.referralCode}
              onClose={() => {
                setViewing(null);
              }}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function Single({
  card,
  items,
  expGained,
  leveledUpTo,
  payCard,
  holderName,
  bankName,
  beginner,
  onDecide,
  busy,
  onOpen,
}: ResultPanelProps & { card: CardView; onOpen: (card: CardView) => void }) {
  const { t } = useTranslation('game');
  const reduced = useReducedMotion() ?? false;
  const tilt = useTilt();
  const item = items?.find((i) => i.card.id === card.id);
  const fresh = item !== undefined && !reduced;
  const name = bankName(card.bankId);

  return (
    <div className="result">
      <div className="result-main">
        {fresh && (
          <motion.div
            className="result-flash"
            style={{
              background: `radial-gradient(circle, ${FLASH[card.tier] ?? FLASH.common}, transparent 70%)`,
            }}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: [0, 1, 0], scale: [0.4, 1.4, 1.8] }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          />
        )}
        {items && <TierBanner cards={[card]} items={items} />}
        <motion.div
          className={`result-card aura aura--${card.tier}`}
          onClick={() => {
            onOpen(card);
          }}
          onPointerMove={tilt.onPointerMove}
          onPointerLeave={tilt.onPointerLeave}
          initial={fresh ? { scale: 0.55, y: 40, opacity: 0 } : false}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
          style={tilt.style}
        >
          <Card
            card={card}
            holderName={holderName}
            {...(name && { bankName: name })}
            style={{ '--card-width': 'var(--single-w)' } as CSSProperties}
          />
        </motion.div>
        <div className="result-value">
          <span className="result-value-label">{t('result.won')}</span>
          <BalanceCounter value={card.balance} currency={card.currency} animateFromZero={fresh} />
        </div>
      </div>

      {/* Info and actions sit in a footer pinned to the bottom: buttons never move. */}
      <div className="result-footer">
        {item && <Badges item={item} expGained={expGained} leveledUpTo={leveledUpTo} />}
        {item?.nearMiss && <NearMiss nearMiss={item.nearMiss} />}
        {!item && <p className="result-pending">{t('result.pending')}</p>}
        <Actions card={card} payCard={payCard} onDecide={onDecide} busy={busy} />
        {beginner && (
          <Explain
            amount={formatMoney(card.cashoutValue, card.currency)}
            fee={card.cashoutValue < card.balance}
            payCard={payCard}
            many={false}
          />
        )}
      </div>
    </div>
  );
}

function Many({
  cards,
  items,
  expGained,
  leveledUpTo,
  payCard,
  holderName,
  beginner,
  onDecide,
  onDecideAll,
  busy,
  onOpen,
}: ResultPanelProps & { onOpen: (card: CardView) => void }) {
  const { t } = useTranslation('game');
  const total = cards.reduce((sum, c) => sum + c.cashoutValue, 0);
  const currency = cards[0]?.currency ?? 'RUB';
  const nearMiss = items?.find(
    (i) => i.nearMiss && cards.some((c) => c.id === i.card.id),
  )?.nearMiss;
  const firstItem = items?.[0];

  return (
    <div className="result result--many">
      <div className="result-main">
        {items && <TierBanner cards={cards} items={items} />}
        <div className={`result-grid result-grid--rows${String(Math.ceil(cards.length / 2))}`}>
          {cards.map((card, i) => (
            <motion.div
              key={card.id}
              className="result-cell"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.08 }}
            >
              <div
                className={`aura aura--${card.tier}`}
                role="button"
                tabIndex={0}
                aria-label={t('viewer.open')}
                onClick={() => {
                  onOpen(card);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpen(card);
                }}
              >
                <Card
                  card={card}
                  holderName={holderName}
                  animated={false}
                  style={{ '--card-width': 'var(--cell-w)' } as CSSProperties}
                />
              </div>
              <div className="result-cell-actions">
                <button
                  type="button"
                  className="button button--tiny button--primary"
                  disabled={busy}
                  onClick={() => {
                    onDecide(card.id, payCard ? 'toCard' : 'toWallet');
                  }}
                >
                  {formatMoney(card.cashoutValue, card.currency)}
                </button>
                <button
                  type="button"
                  className="button button--tiny button--icon"
                  disabled={busy}
                  aria-label={t('result.hold')}
                  title={t('result.hold')}
                  onClick={() => {
                    onDecide(card.id, 'hold');
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 6h16v13H4zM4 10h16M9 14h6" />
                  </svg>
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
      <div className="result-footer">
        {firstItem && <Badges item={firstItem} expGained={expGained} leveledUpTo={leveledUpTo} />}
        {nearMiss && <NearMiss nearMiss={nearMiss} />}
        <div className="result-actions result-actions--stack">
          {payCard ? (
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => {
                onDecideAll('toCard');
              }}
            >
              {t('result.allToCard', { last4: payCard.number.slice(-4) })}{' '}
              <span className="sum">{formatMoney(total, currency)}</span>
            </button>
          ) : null}
          <div className="result-actions">
            <button
              type="button"
              className={`button ${payCard ? '' : 'button--primary'}`}
              disabled={busy}
              onClick={() => {
                onDecideAll('toWallet');
              }}
            >
              {t('result.allToWallet')}
              {!payCard && (
                <>
                  {' '}
                  <span className="sum">{formatMoney(total, currency)}</span>
                </>
              )}
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                onDecideAll('hold');
              }}
            >
              {t('result.allToHolder')}
            </button>
          </div>
        </div>
        {beginner && (
          <Explain
            amount={formatMoney(total, currency)}
            fee={cards.some((c) => c.cashoutValue < c.balance)}
            payCard={payCard}
            many
          />
        )}
      </div>
    </div>
  );
}

function Actions({
  card,
  payCard,
  onDecide,
  busy,
}: {
  card: CardView;
  payCard: CardView | null;
  onDecide: ResultPanelProps['onDecide'];
  busy: boolean;
}) {
  const { t } = useTranslation('game');
  const amount = formatMoney(card.cashoutValue, card.currency);
  if (payCard) {
    return (
      <div className="result-actions result-actions--stack">
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={() => {
            onDecide(card.id, 'toCard');
          }}
        >
          {t('result.toCard', { last4: payCard.number.slice(-4) })}{' '}
          <span className="sum">{amount}</span>
        </button>
        <div className="result-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              onDecide(card.id, 'toWallet');
            }}
          >
            {t('result.toWallet')} {amount}
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              onDecide(card.id, 'hold');
            }}
          >
            {t('result.hold')}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="result-actions">
      <button
        type="button"
        className="button button--primary"
        disabled={busy}
        onClick={() => {
          onDecide(card.id, 'toWallet');
        }}
      >
        {t('result.cashout')} <span className="sum">{amount}</span>
      </button>
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={() => {
          onDecide(card.id, 'hold');
        }}
      >
        {t('result.hold')}
      </button>
    </div>
  );
}

/** What each of the two choices means, for new players. */
function Explain({
  amount,
  fee,
  payCard,
  many,
}: {
  amount: string;
  /** The cash-out is less than the card balance (level fee). */
  fee: boolean;
  payCard: CardView | null;
  many: boolean;
}) {
  const { t } = useTranslation('game');
  return (
    <ul className="result-explain">
      <li>
        {payCard
          ? t('result.explainTakeToCard', { amount, last4: payCard.number.slice(-4) })
          : t('result.explainTake', { amount })}
        {fee && ` ${t('result.explainFee')}`}
      </li>
      <li>{t(many ? 'result.explainKeepMany' : 'result.explainKeep')}</li>
    </ul>
  );
}

function BalanceCounter({
  value,
  currency,
  animateFromZero,
}: {
  value: number;
  currency: string;
  animateFromZero: boolean;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!animateFromZero) return;
    const control = animate(0, value, {
      duration: 1.1,
      ease: 'easeOut',
      onUpdate: (v) => {
        setShown(Math.round(v));
      },
    });
    return () => {
      control.stop();
    };
  }, [value, animateFromZero]);
  return (
    <span className="result-value-amount">
      {formatMoney(animateFromZero ? shown : value, currency)}
    </span>
  );
}

function Badges({
  item,
  expGained,
  leveledUpTo,
}: {
  item: SpinItem;
  expGained?: number | undefined;
  leveledUpTo?: number | null | undefined;
}) {
  const { t } = useTranslation('game');
  const badges: string[] = [];
  if (item.lucky === 'milestone') badges.push(t('result.milestone'));
  else if (item.lucky) badges.push(t('result.lucky'));
  if (item.guaranteeApplied) badges.push(t('result.guarantee'));
  else if (item.pityApplied) badges.push(t('result.pity'));
  if (expGained) badges.push(t('result.expGained', { exp: expGained }));
  if (leveledUpTo) badges.push(t('result.newLevel', { level: leveledUpTo }));
  if (badges.length === 0) return null;
  return (
    <div className="badges">
      {badges.map((b) => (
        <span key={b} className="badge">
          {b}
        </span>
      ))}
    </div>
  );
}

/** Honest hint about the number that actually dropped; no promise about the next spin. */
function NearMiss({ nearMiss }: { nearMiss: NearMissView }) {
  const { t } = useTranslation('game');
  return (
    <motion.div
      className="near-miss"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
    >
      <strong>{t('nearMiss.title', { pattern: t(`patterns.${nearMiss.patternId}`) })}</strong>
      <span>{t('nearMiss.hint')}</span>
    </motion.div>
  );
}

const TIER_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];

/** A banner for the best card of a fresh drop (Epic and up) or for a milestone spin. */
function TierBanner({ cards, items }: { cards: CardView[]; items: SpinItem[] }) {
  const { t } = useTranslation('game');
  const best = cards.reduce<CardView | null>(
    (top, c) => (!top || TIER_ORDER.indexOf(c.tier) > TIER_ORDER.indexOf(top.tier) ? c : top),
    null,
  );
  const milestone = items.some((i) => i.lucky === 'milestone');
  const rank = best ? TIER_ORDER.indexOf(best.tier) : 0;
  if (!best || (rank < 2 && !milestone)) return null;
  return (
    <motion.div
      className={`tier-banner tier-banner--${rank >= 2 ? best.tier : 'milestone'}`}
      initial={{ opacity: 0, scale: 0.6, y: -10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.15 }}
    >
      {milestone && <span>{t('result.milestone')}</span>}
      {rank >= 2 && <strong>{t(`result.banner.${best.tier}`)}</strong>}
    </motion.div>
  );
}
