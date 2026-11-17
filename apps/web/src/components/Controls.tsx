import {
  type Currency,
  MAX_SPINS_PER_REQUEST,
  type MeResponse,
  type PublicPack,
} from '@spincards/shared';
import { useTranslation } from 'react-i18next';
import { haptics } from '../app/telegram';
import { formatCountdown, formatMoney } from '../lib/format';
import { packPrice } from '../lib/packs';
import { useNow } from '../lib/useNow';

interface PackPickerProps {
  packs: PublicPack[];
  selected: string;
  onSelect: (id: string) => void;
  me: MeResponse;
  currency: Currency;
  disabled: boolean;
}

/** Packs as compact chips; the free pack only while free spins are available, a timer otherwise. */
export function PackPicker({ packs, selected, onSelect, me, currency, disabled }: PackPickerProps) {
  const { t } = useTranslation(['game', 'common']);
  const now = useNow();
  const { available, nextAt } = me.game.freeSpins;
  const shown = packs.filter((p) => !p.free || available > 0);

  return (
    <div className="packs-wrap">
      <div className="packs" role="radiogroup" aria-label={t('packs.title')}>
        {shown.map((pack) => {
          const locked = me.level < pack.unlockLevel;
          const isSelected = pack.id === selected;
          const detail = locked
            ? t('common:lockedLevel', { level: pack.unlockLevel })
            : pack.free
              ? t('packs.freeLeft', { count: available })
              : formatMoney(packPrice(pack, currency), currency);
          return (
            <button
              key={pack.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`pack ${isSelected ? 'is-active' : ''} ${locked ? 'is-locked' : ''} ${pack.free ? 'pack--free' : ''}`}
              disabled={disabled || locked}
              onClick={() => {
                haptics.select();
                onSelect(pack.id);
              }}
            >
              <span className="pack-name">{t(`packs.${pack.id}`, { defaultValue: pack.id })}</span>
              <span className="pack-detail">{detail}</span>
            </button>
          );
        })}
      </div>
      {available === 0 && nextAt && (
        <span className="hint packs-timer">
          {t('packs.freeIn', { time: formatCountdown(Date.parse(nextAt) - now) })}
        </span>
      )}
    </div>
  );
}

export function CountPicker({
  count,
  max,
  onChange,
  disabled,
}: {
  count: number;
  max: number;
  onChange: (n: number) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation('game');
  return (
    <div className="segmented count-picker" role="radiogroup" aria-label={t('spin.countLabel')}>
      {Array.from({ length: MAX_SPINS_PER_REQUEST }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={count === n}
          className={count === n ? 'is-active' : ''}
          disabled={disabled || n > max}
          onClick={() => {
            haptics.select();
            onChange(n);
          }}
        >
          {t('spin.count', { count: n })}
        </button>
      ))}
    </div>
  );
}

/**
 * Progress to a lucky spin: the luck meter (`full` at max) or the milestone (every N-th spin,
 * lucky when only this spin is left).
 */
export function LuckMeter({
  value,
  max,
  kind = 'meter',
}: {
  value: number;
  max: number;
  kind?: 'meter' | 'milestone';
}) {
  const { t } = useTranslation('game');
  const full = kind === 'meter' ? value >= max : value >= max - 1;
  const label = kind === 'meter' ? t('luckMeter.label') : t('luckMeter.milestone');
  return (
    <div className={`luck-meter luck-meter--${kind} ${full ? 'is-full' : ''}`}>
      <div className="luck-meter-head">
        <span className="section-label">{label}</span>
        <span className="luck-meter-value" title={full ? t('luckMeter.lucky') : undefined}>
          {full ? t('luckMeter.ready') : t('luckMeter.value', { value, max })}
        </span>
      </div>
      <div
        className="luck-meter-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <span
          className="luck-meter-fill"
          style={{ width: `${String((Math.min(value, max) / max) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** Only the chest opens right here; the wheel, the daily reward and quests wait behind the header gift. */
export function QuickBonuses({
  chestReady,
  onChest,
  busy,
}: {
  chestReady: boolean;
  onChest: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation('game');
  if (!chestReady) return null;
  return (
    <div className="quick">
      <button type="button" className="quick-chip" onClick={onChest} disabled={busy}>
        🎁 {t('quick.chest')}
      </button>
    </div>
  );
}
