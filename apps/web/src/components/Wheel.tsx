import type { Currency, MeResponse, PublicConfigResponse } from '@spincards/shared';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRefreshBalances, useWheelSpin } from '../api/queries';
import { haptics } from '../app/telegram';
import { errorText } from '../lib/errors';
import { formatCountdown, formatMoney } from '../lib/format';
import { credited, describeReward, scaleMoney } from '../lib/rewards';
import { useNow } from '../lib/useNow';
import { useToast } from '../state/toast';
import { StarsButton } from './StarsButton';

/** D-168: deep banknote inks, all dark enough for white labels. */
const SEGMENT_COLORS = [
  '#1e5a45',
  '#8a6a2a',
  '#6e2430',
  '#1f6070',
  '#3f5a2a',
  '#7a4a2a',
  '#2a3f66',
  '#5a4a1a',
];

export function Wheel({
  me,
  config,
  currency,
}: {
  me: MeResponse;
  config: PublicConfigResponse;
  currency: Currency;
}) {
  const { t } = useTranslation(['shop', 'game']);
  const toast = useToast((s) => s.show);
  const spin = useWheelSpin();
  const refresh = useRefreshBalances();
  const reduced = useReducedMotion() ?? false;
  const now = useNow();
  const rotation = useMotionValue(0);
  const transform = useTransform(rotation, (r) => `rotate(${String(r)}deg)`);
  const [spinning, setSpinning] = useState(false);
  const segments = config.wheel.segments;
  const angle = 360 / segments.length;
  const availableAt = me.game.wheel.availableAt;
  const ready = availableAt === null || Date.parse(availableAt) <= now;

  const label = (i: number) => {
    const s = segments[i];
    if (!s) return '';
    const money = s.money?.[currency];
    if (money)
      return formatMoney(scaleMoney(money, me.level, config), currency).replace(/\s?[₽$]/, '');
    if (s.freeSpins) return `${String(s.freeSpins)}🎟`;
    if (s.luck) return `+${String(s.luck.points)}🍀`;
    return '';
  };

  const onSpin = () => {
    haptics.impact('heavy');
    setSpinning(true);
    spin.mutate(undefined, {
      onSuccess: (res) => {
        // The pointer is at the top; land on the middle of the winning segment.
        const target =
          rotation.get() +
          360 * 6 +
          (360 - (rotation.get() % 360)) -
          (res.segmentIndex + 0.5) * angle;
        const finish = () => {
          setSpinning(false);
          haptics.notify('success');
          const text = res.segmentId === 'jackpot' ? `${t('bonuses.jackpot')} ` : '';
          toast(
            `${text}${t('bonuses.wheelWon', { reward: describeReward(t, credited(res.reward, res.credited), currency) })}`,
            'success',
          );
          refresh();
        };
        if (reduced) {
          rotation.set(target);
          finish();
        } else {
          void animate(rotation, target, {
            duration: 4.2,
            ease: [0.15, 0.8, 0.1, 1],
            onComplete: finish,
          });
        }
      },
      onError: (e) => {
        setSpinning(false);
        haptics.notify('error');
        toast(errorText(t, e), 'error');
      },
    });
  };

  return (
    <section className="section">
      <div className="wheel">
        <div className="wheel-pointer" />
        <motion.svg viewBox="-100 -100 200 200" className="wheel-disc" style={{ transform }}>
          {segments.map((s, i) => {
            const a0 = ((i * angle - 90) * Math.PI) / 180;
            const a1 = (((i + 1) * angle - 90) * Math.PI) / 180;
            const mid = (((i + 0.5) * angle - 90) * Math.PI) / 180;
            return (
              <g key={s.id}>
                <path
                  d={`M0 0 L${String(96 * Math.cos(a0))} ${String(96 * Math.sin(a0))} A96 96 0 0 1 ${String(96 * Math.cos(a1))} ${String(96 * Math.sin(a1))} Z`}
                  fill={s.id === 'jackpot' ? '#111' : SEGMENT_COLORS[i % SEGMENT_COLORS.length]}
                  stroke="#d9c08a"
                  strokeWidth="1.5"
                />
                <text
                  x={64 * Math.cos(mid)}
                  y={64 * Math.sin(mid)}
                  transform={`rotate(${String((i + 0.5) * angle)} ${String(64 * Math.cos(mid))} ${String(64 * Math.sin(mid))})`}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={`wheel-label ${s.id === 'jackpot' ? 'wheel-label--jackpot' : ''}`}
                >
                  {label(i)}
                </text>
              </g>
            );
          })}
          <circle r="14" fill="#0f1116" stroke="#ffd24a" strokeWidth="3" />
        </motion.svg>
      </div>
      <div className={ready || !config.stars ? 'button-row' : 'button-row button-row--pair'}>
        <button
          type="button"
          className="button button--primary"
          disabled={!ready || spinning || spin.isPending}
          onClick={onSpin}
        >
          {ready
            ? t('bonuses.wheelSpin')
            : t('bonuses.wheelIn', { time: formatCountdown(Date.parse(availableAt) - now) })}
        </button>
        {!ready && config.stars && (
          <StarsButton
            productId="wheel_now"
            stars={config.stars.wheelNow}
            label={t('bonuses.wheelNow')}
            className="button button--stars"
          />
        )}
      </div>
    </section>
  );
}
