import { useTranslation } from 'react-i18next';
import { haptics } from '../app/telegram';
import { formatMoney } from '../lib/format';
import { AMOUNT_STEPS, addStep, minorToInput, parseMajorToMinor } from '../lib/money';

/**
 * Quick amount buttons under an amount input: each step adds to the current amount (first tap sets
 * it), capped by `max`; «Всё» puts the whole available amount, «Сбросить» clears it.
 */
export function AmountPresets({
  currency,
  max,
  input,
  onInput,
}: {
  currency: string;
  /** Available amount in minor units. */
  max: number;
  input: string;
  onInput: (value: string) => void;
}) {
  const { t } = useTranslation('common');
  const current = parseMajorToMinor(input);
  if (max <= 0) return null;
  const set = (minor: number) => {
    haptics.select();
    onInput(minorToInput(minor));
  };
  return (
    <div className="presets">
      {(AMOUNT_STEPS[currency] ?? []).map((step) => (
        <button
          key={step}
          type="button"
          className="chip-button"
          disabled={current !== null && current >= max}
          onClick={() => {
            set(addStep(current, step, max));
          }}
        >
          {current ? '+' : ''}
          {formatMoney(step, currency)}
        </button>
      ))}
      <button
        type="button"
        className="chip-button"
        onClick={() => {
          set(max);
        }}
      >
        {t('amount.all', { amount: formatMoney(max, currency) })}
      </button>
      {current !== null && (
        <button
          type="button"
          className="chip-button chip-button--ghost"
          onClick={() => {
            haptics.select();
            onInput('');
          }}
        >
          {t('amount.clear')}
        </button>
      )}
    </div>
  );
}
