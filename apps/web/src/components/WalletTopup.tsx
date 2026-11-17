import type { Currency, MeResponse } from '@spincards/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CollectButton } from './CollectButton';
import { useHolder, useTransfer } from '../api/queries';
import { haptics } from '../app/telegram';
import { errorText } from '../lib/errors';
import { formatMoney, formatPercentBp } from '../lib/format';
import { minorToInput, parseMajorToMinor } from '../lib/money';
import { paymentCards } from '../lib/packs';
import { useNow } from '../lib/useNow';
import { useToast } from '../state/toast';
import { AmountPresets } from './AmountPresets';

/** How much to take from a card so that the wallet receives `need` after the cash-out fee. */
function grossFor(need: number, feeBp: number): number {
  if (need <= 0) return 0;
  let gross = Math.ceil((need * 10_000) / (10_000 - feeBp));
  // The server rounds the fee up: step until the wallet really receives `need`.
  while (gross - Math.ceil((gross * feeBp) / 10_000) < need) gross += 1;
  return gross;
}

/** Money from a kept card into the wallet: the fee is the cash-out fee of the player's level. */
export function WalletTopup({
  me,
  currency,
  need = 0,
  onDone,
}: {
  me: MeResponse;
  currency: Currency;
  /** What the wallet must receive: picks a card that covers it and fills the amount with the fee. */
  need?: number;
  onDone: () => void;
}) {
  const { t } = useTranslation(['shop', 'game']);
  const toast = useToast((s) => s.show);
  const holder = useHolder();
  const transfer = useTransfer();
  const now = useNow(30_000);
  const cards = paymentCards(holder.data?.cards ?? [], currency, now).sort(
    (a, b) => b.balance - a.balance,
  );
  const feeBp = me.game.cashoutFeeBp;
  const gross = grossFor(need, feeBp);
  const [cardId, setCardId] = useState<string | null>(null);
  const card =
    cards.find((c) => c.id === cardId) ??
    (need > 0 ? cards.find((c) => c.balance >= gross) : undefined) ??
    cards.find((c) => c.balance > 0);
  // Until the player types, the amount follows the picked card (cards may load after the sheet opens).
  const [typed, setInput] = useState<string | null>(null);
  const input = typed ?? (need > 0 && card ? minorToInput(Math.min(gross, card.balance)) : '');
  const amount = parseMajorToMinor(input);
  const fee = amount ? Math.ceil((amount * feeBp) / 10_000) : 0;
  const received = amount ? amount - fee : 0;
  const valid = !!card && amount !== null && amount > 0 && amount <= card.balance && received > 0;

  return (
    <>
      {cards.length === 0 ? (
        <p className="hint">{t('wallet.topupNoCards')}</p>
      ) : (
        <>
          {cards.filter((c) => c.balance > 0).length > 1 && need === 0 && (
            <CollectButton
              currency={currency}
              to={{ type: 'wallet' }}
              label={t('game:collect.toWallet')}
              onDone={onDone}
            />
          )}
          <span className="section-label">{t('game:transfer.from')}</span>
          <div
            className="pay-list topup-cards"
            role="radiogroup"
            aria-label={t('game:transfer.from')}
          >
            {cards.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={card?.id === c.id}
                aria-label={t('game:transfer.card', { last4: c.number.slice(-4) })}
                className={`pay-row ${card?.id === c.id ? 'is-active' : ''}`}
                disabled={c.balance === 0}
                onClick={() => {
                  haptics.select();
                  setCardId(c.id);
                  setInput(null);
                }}
              >
                <span className={`pay-dot pay-dot--${c.tier}`} aria-hidden="true" />
                <span className="pay-row-main">
                  <b>{t('game:transfer.card', { last4: c.number.slice(-4) })}</b>
                  <span className="hint">{t(`game:tiers.${c.tier}`)}</span>
                </span>
                <span className="pay-row-side">
                  <b>{formatMoney(c.balance, c.currency)}</b>
                  <span className="pay-luck">🍀 {c.luckPoints}</span>
                </span>
              </button>
            ))}
          </div>
          <input
            className="input"
            inputMode="decimal"
            placeholder={t('wallet.amount')}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
            }}
          />
          <AmountPresets
            currency={currency}
            max={card?.balance ?? 0}
            input={input}
            onInput={setInput}
          />
          <p className="hint">
            {feeBp === 0
              ? t('game:transfer.noFee')
              : t('game:transfer.fee', {
                  fee: `${formatMoney(fee, currency)} (${formatPercentBp(feeBp)})`,
                  received: formatMoney(received, currency),
                })}
          </p>
          <button
            type="button"
            className="button button--primary"
            disabled={!valid || transfer.isPending}
            onClick={() => {
              if (!card || !amount) return;
              transfer.mutate(
                { from: { type: 'card', cardId: card.id }, to: { type: 'wallet' }, amount },
                {
                  onSuccess: (res) => {
                    haptics.notify('success');
                    toast(
                      t('game:transfer.done', { amount: formatMoney(res.received, currency) }),
                      'success',
                    );
                    onDone();
                  },
                  onError: (e) => {
                    haptics.notify('error');
                    toast(errorText(t, e), 'error');
                  },
                },
              );
            }}
          >
            {t('wallet.topupButton')}
          </button>
        </>
      )}
    </>
  );
}
