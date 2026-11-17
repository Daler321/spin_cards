import type { CardView, Currency, MeResponse, PublicPack } from '@spincards/shared';
import { AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { haptics } from '../app/telegram';
import type { PaymentChoice } from '../lib/packs';
import { CountPicker, PackPicker } from './Controls';
import { Sheet } from './Overlay';
import { PaymentSheet } from './PaymentSheet';
import { RegionToggle } from './RegionToggle';

interface SpinOptionsProps {
  me: MeResponse;
  packs: PublicPack[];
  pack: PublicPack | undefined;
  onPack: (id: string) => void;
  count: number;
  maxCount: number;
  onCount: (n: number) => void;
  /** Held active cards of the region currency. */
  cards: CardView[];
  payCard: CardView | undefined;
  total: number;
  onPayment: (choice: PaymentChoice) => void;
  walletBalance: number;
  currency: Currency;
  bankName: (bankId: string) => string | undefined;
  disabled: boolean;
}

type Open = 'pack' | 'count' | 'pay' | null;

/** One row above «Крутить»: currency, pack, count and what pays; each choice opens a sheet. */
export function SpinOptions(props: SpinOptionsProps) {
  const { me, packs, pack, count, maxCount, cards, payCard, currency, disabled } = props;
  const { t } = useTranslation('game');
  const [open, setOpen] = useState<Open>(null);
  const close = () => {
    setOpen(null);
  };
  const show = (what: Open) => {
    haptics.select();
    setOpen(what);
  };
  const free = me.game.freeSpins.available;
  const freePack = packs.find((p) => p.free);
  // Free spins wait while a paid pack is picked: the pack button lights up and one tap takes them.
  const freeReady = !!freePack && free > 0 && !pack?.free;

  return (
    <div className="spin-options">
      <RegionToggle region={me.region} disabled={disabled} />

      <button
        type="button"
        className={`option-chip option-chip--grow ${freeReady ? 'is-glow' : ''}`}
        aria-label={freeReady ? t('packs.freeReady', { count: free }) : t('packs.title')}
        disabled={disabled}
        onClick={() => {
          if (freeReady) {
            haptics.impact('light');
            props.onPack(freePack.id);
          } else show('pack');
        }}
      >
        <span className="option-chip-text">
          {freeReady
            ? t('packs.freeReady', { count: free })
            : pack
              ? t(`packs.${pack.id}`, { defaultValue: pack.id })
              : t('packs.title')}
        </span>
        {!freeReady && <Chevron />}
      </button>

      <button
        type="button"
        className="option-chip"
        aria-label={t('spin.countLabel')}
        disabled={disabled}
        onClick={() => {
          show('count');
        }}
      >
        <span className="option-chip-text">{t('spin.count', { count })}</span>
      </button>

      {pack && !pack.free && (
        <button
          type="button"
          className="option-chip option-chip--grow"
          aria-label={t('pay.title')}
          disabled={disabled}
          onClick={() => {
            show('pay');
          }}
        >
          <span className="option-chip-text">
            {payCard ? `•••• ${payCard.number.slice(-4)}` : t('pay.wallet')}
          </span>
          {payCard && <span className="option-chip-luck">🍀{payCard.luckPoints}</span>}
          <Chevron />
        </button>
      )}

      <AnimatePresence>
        {open === 'pack' && (
          <Sheet onClose={close}>
            <h3>{t('packs.title')}</h3>
            <PackPicker
              packs={packs}
              selected={pack?.id ?? ''}
              onSelect={(id) => {
                props.onPack(id);
                close();
              }}
              me={me}
              currency={currency}
              disabled={disabled}
            />
          </Sheet>
        )}
        {open === 'count' && (
          <Sheet onClose={close}>
            <h3>{t('spin.countLabel')}</h3>
            <CountPicker
              count={count}
              max={maxCount}
              onChange={(n) => {
                props.onCount(n);
                close();
              }}
              disabled={disabled}
            />
          </Sheet>
        )}
        {open === 'pay' && (
          <Sheet onClose={close}>
            <PaymentSheet
              cards={cards}
              total={props.total}
              choice={payCard ? { type: 'card', cardId: payCard.id } : { type: 'wallet' }}
              onChoose={(choice) => {
                props.onPayment(choice);
                close();
              }}
              walletBalance={props.walletBalance}
              currency={currency}
              holderName={me.firstName}
              bankName={props.bankName}
            />
          </Sheet>
        )}
      </AnimatePresence>
    </div>
  );
}

function Chevron() {
  return (
    <svg className="option-chip-chevron" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
