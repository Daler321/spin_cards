import type { MiniGameWallet } from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { formatMoney, formatPercentBp } from '../../lib/format';
import { AmountPresets } from '../AmountPresets';

/** The bet: an amount within [minBet, max]; `max` is the wallet limit (or its share per ball). */
export function BetField({
  label,
  wallet,
  max,
  shareBp,
  input,
  onInput,
  disabled = false,
}: {
  label: string;
  wallet: MiniGameWallet;
  max: number;
  shareBp: number;
  input: string;
  onInput: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('game');
  const { currency, minBet } = wallet;
  return (
    <div className="mg-field">
      <span className="section-label">{label}</span>
      <input
        className="input"
        inputMode="decimal"
        placeholder={formatMoney(minBet, currency)}
        value={input}
        disabled={disabled}
        onChange={(e) => {
          onInput(e.target.value);
        }}
      />
      {!disabled && <AmountPresets currency={currency} max={max} input={input} onInput={onInput} />}
      <span className="hint">
        {max >= minBet
          ? t('minigames.betLimit', {
              min: formatMoney(minBet, currency),
              max: formatMoney(max, currency),
              share: formatPercentBp(shareBp),
            })
          : t('minigames.betNotAllowed', { min: formatMoney(minBet, currency) })}
      </span>
    </div>
  );
}
