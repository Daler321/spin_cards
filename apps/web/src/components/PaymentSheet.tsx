import type { CardView, Currency } from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { haptics } from '../app/telegram';
import { formatMoney } from '../lib/format';
import type { PaymentChoice } from '../lib/packs';
import { type PaySort, useSelection } from '../state/selection';
import { Card } from './card/Card';

interface PaymentSheetProps {
  /** Held active cards of the region currency. */
  cards: CardView[];
  /** Price of the whole batch. */
  total: number;
  choice: PaymentChoice;
  onChoose: (choice: PaymentChoice) => void;
  walletBalance: number;
  currency: Currency;
  holderName: string;
  bankName: (bankId: string) => string | undefined;
}

/** Cards out of spins (D-121) go last; the rest follow the picked order. */
function sortPayCards(cards: CardView[], sort: PaySort): CardView[] {
  const limited = (c: CardView) => Number(c.spinLimit.left === 0);
  return [...cards].sort(
    (a, b) =>
      limited(a) - limited(b) ||
      (sort === 'luck'
        ? b.luckPoints - a.luckPoints || b.balance - a.balance
        : b.balance - a.balance || b.luckPoints - a.luckPoints),
  );
}

/** What pays for the spin: the wallet or a kept card, as a compact list or the cards themselves. */
export function PaymentSheet({
  cards,
  total,
  choice,
  onChoose,
  walletBalance,
  currency,
  holderName,
  bankName,
}: PaymentSheetProps) {
  const { t } = useTranslation('game');
  const { payView, paySort, setPayView, setPaySort } = useSelection();
  const sorted = sortPayCards(cards, paySort);
  const choose = (next: PaymentChoice) => {
    haptics.select();
    onChoose(next);
  };
  const status = (card: CardView) =>
    card.spinLimit.left === 0
      ? t('pay.limitReached')
      : card.balance < total
        ? t('pay.notEnough')
        : card.spinLimit.left < card.spinLimit.max
          ? t('pay.spinsLeft', { count: card.spinLimit.left })
          : null;

  return (
    <div className="pay-sheet">
      <h3>{t('pay.title')}</h3>
      <div className="pay-sheet-bar">
        <div className="segmented" role="radiogroup" aria-label={t('pay.view')}>
          {(['list', 'cards'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={payView === id}
              className={payView === id ? 'is-active' : ''}
              onClick={() => {
                setPayView(id);
              }}
            >
              {t(`pay.views.${id}`)}
            </button>
          ))}
        </div>
        <div className="pay-sheet-sort" role="radiogroup" aria-label={t('pay.sort')}>
          {(['luck', 'balance'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={paySort === id}
              className={`chip-button ${paySort === id ? 'is-active' : 'chip-button--ghost'}`}
              onClick={() => {
                setPaySort(id);
              }}
            >
              {t(`pay.sorts.${id}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="pay-sheet-body" role="radiogroup" aria-label={t('pay.title')}>
        <button
          type="button"
          role="radio"
          aria-checked={choice.type === 'wallet'}
          className={`pay-row ${choice.type === 'wallet' ? 'is-active' : ''}`}
          onClick={() => {
            choose({ type: 'wallet' });
          }}
        >
          <span className="pay-row-main">
            <b>{t('pay.wallet')}</b>
            <span className="hint">{t('pay.walletHint')}</span>
          </span>
          <span className="pay-row-side">
            <b className={walletBalance < total ? 'is-short' : ''}>
              {formatMoney(walletBalance, currency)}
            </b>
            <span className="pay-luck">🍀 0</span>
          </span>
        </button>

        {sorted.length === 0 && <p className="hint pay-empty">{t('pay.noCards')}</p>}

        <div className={payView === 'cards' ? 'pay-grid' : 'pay-list'}>
          {sorted.map((card) => {
            const active = choice.type === 'card' && choice.cardId === card.id;
            const short = card.balance < total || card.spinLimit.left === 0;
            const note = status(card);
            const bank = bankName(card.bankId);
            return (
              <button
                key={card.id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={t('pay.card', { last4: card.number.slice(-4) })}
                className={`${payView === 'cards' ? 'pay-tile' : 'pay-row'} ${active ? 'is-active' : ''} ${short ? 'is-short' : ''}`}
                disabled={card.spinLimit.left === 0}
                onClick={() => {
                  choose({ type: 'card', cardId: card.id });
                }}
              >
                {payView === 'cards' ? (
                  <>
                    <Card
                      card={card}
                      holderName={holderName}
                      {...(bank && { bankName: bank })}
                      showBalance={false}
                      animated={false}
                      className="gc--fluid"
                    />
                    <span className="pay-tile-info">
                      <b className={short ? 'is-short' : ''}>
                        {formatMoney(card.balance, card.currency)}
                      </b>
                      <span className="pay-luck">🍀 {card.luckPoints}</span>
                    </span>
                    {note && <span className="hint pay-note">{note}</span>}
                  </>
                ) : (
                  <>
                    <span className={`pay-dot pay-dot--${card.tier}`} aria-hidden="true" />
                    <span className="pay-row-main">
                      <b>{t('pay.card', { last4: card.number.slice(-4) })}</b>
                      <span className="hint">
                        {t(`tiers.${card.tier}`)}
                        {note && <> · {note}</>}
                      </span>
                    </span>
                    <span className="pay-row-side">
                      <b className={short ? 'is-short' : ''}>
                        {formatMoney(card.balance, card.currency)}
                      </b>
                      <span className="pay-luck">🍀 {card.luckPoints}</span>
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
