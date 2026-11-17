import type { MiniGameDifficulty, PlinkoResponse } from '@spincards/shared';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMiniGamesRefresh, usePlinko } from '../../api/queries';
import { haptics } from '../../app/telegram';
import { errorText } from '../../lib/errors';
import { formatMoney, formatMultBp } from '../../lib/format';
import { validBet } from '../../lib/money';
import { useToast } from '../../state/toast';
import { BetField } from './BetField';
import { Rules } from './Rules';
import { Segmented } from './Segmented';
import type { MiniGameProps } from './types';

const W = 320;
const TOP = 14;
const BALL_STAGGER_S = 0.14;
const ROW_S = 0.11;

/** Board geometry: row i has i + 1 pegs, a ball bounces off one of them per row. */
function geometry(rows: number) {
  const dx = W / (rows + 2);
  const dy = dx * 0.86;
  const cupY = TOP + rows * dy + 6;
  return { dx, dy, cupY, height: cupY + 30 };
}

/**
 * D-169 plinko: the server drops every ball (path of left/right bounces) before the animation; the
 * client replays the paths.
 */
export function Plinko({ info, wallet }: MiniGameProps) {
  const { t } = useTranslation('game');
  const toast = useToast((s) => s.show);
  const refresh = useMiniGamesRefresh();
  const drop = usePlinko();
  const reduced = useReducedMotion();
  const [difficulty, setDifficulty] = useState<MiniGameDifficulty>('easy');
  const [balls, setBalls] = useState(1);
  const [input, setInput] = useState('');
  const [result, setResult] = useState<PlinkoResponse | null>(null);
  const [landed, setLanded] = useState(0);
  const board = info.plinko.difficulties.find((d) => d.id === difficulty) ??
    info.plinko.difficulties[0] ?? { id: 'easy', rows: 8, multipliersBp: [] };
  const rows = result?.rows ?? board.rows;
  const { dx, dy, cupY, height } = geometry(rows);
  const cups = result
    ? (info.plinko.difficulties.find((d) => d.rows === result.rows)?.multipliersBp ?? [])
    : board.multipliersBp;
  const maxPerBall = Math.floor(wallet.maxBet / balls);
  const bet = validBet(input, wallet.minBet, maxPerBall);
  const flying = result !== null && landed < result.balls.length;
  const busy = drop.isPending || flying;

  const onDrop = () => {
    if (bet === null) return;
    haptics.impact('light');
    drop.mutate(
      { currency: wallet.currency, betPerBall: bet, balls, difficulty },
      {
        onSuccess: (res) => {
          setLanded(reduced ? res.balls.length : 0);
          setResult(res);
        },
        onError: (error) => {
          haptics.notify('error');
          toast(errorText(t, error), 'error');
        },
      },
    );
  };
  const onLanded = () => {
    haptics.select();
    setLanded((n) => n + 1);
  };
  const done = result !== null && landed === result.balls.length;
  useEffect(() => {
    if (!done) return;
    refresh();
    haptics.notify(result.payout >= result.bet ? 'success' : 'warning');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- why: once per drop (round id)
  }, [done, result?.roundId]);

  const hits = new Map<number, number>();
  if (result && !flying) for (const b of result.balls) hits.set(b.cup, (hits.get(b.cup) ?? 0) + 1);
  const mid = rows / 2;
  const maxMult = Math.max(...cups, 1);
  const minMult = Math.min(...cups);

  return (
    <>
      <div className="mg-field">
        <span className="section-label">{t('minigames.difficulty')}</span>
        <Segmented
          value={difficulty}
          disabled={busy}
          options={info.plinko.difficulties.map((d) => ({
            id: d.id,
            label: t(`minigames.difficulties.${d.id}`),
          }))}
          onChange={(id) => {
            setDifficulty(id);
            setResult(null);
          }}
        />
      </div>

      <svg className="plinko" viewBox={`0 0 ${String(W)} ${String(height)}`} role="img">
        {Array.from({ length: rows }, (_, i) =>
          Array.from({ length: i + 1 }, (_, j) => (
            <circle
              key={`${String(i)}-${String(j)}`}
              className="plinko-peg"
              cx={W / 2 + (j - i / 2) * dx}
              cy={TOP + i * dy}
              r={2.4}
            />
          )),
        )}
        {cups.map((mult, k) => {
          const x = W / 2 + (k - mid) * dx;
          const tone = mult >= 10_000 ? 'plus' : 'minus';
          return (
            <g key={k} className={`plinko-cup plinko-cup--${tone}`}>
              <rect
                x={x - dx / 2 + 1}
                y={cupY}
                width={dx - 2}
                height={22}
                rx={4}
                className={hits.has(k) ? 'is-hit' : ''}
              />
              <text x={x} y={cupY + 14.5} textAnchor="middle">
                {formatMultBp(mult)}
              </text>
            </g>
          );
        })}
        {result &&
          !reduced &&
          result.balls.map((ball, b) => {
            const xs = [W / 2];
            const ys = [TOP - dy];
            let offset = 0;
            ball.path.forEach((step, i) => {
              xs.push(W / 2 + offset * (dx / 2));
              ys.push(TOP + i * dy - 5);
              offset += step === 1 ? 1 : -1;
            });
            xs.push(W / 2 + offset * (dx / 2));
            ys.push(cupY + 8);
            return (
              <motion.circle
                key={`${result.roundId}-${String(b)}`}
                className="plinko-ball"
                r={4.5}
                initial={{ cx: xs[0], cy: ys[0], opacity: 1 }}
                // The ball fades in its cup so the multipliers stay readable.
                animate={{ cx: xs, cy: ys, opacity: [...xs.slice(1).map(() => 1), 0] }}
                transition={{
                  duration: (rows + 1) * ROW_S,
                  delay: b * BALL_STAGGER_S,
                  ease: 'linear',
                }}
                onAnimationComplete={onLanded}
              />
            );
          })}
      </svg>
      {hits.size > 0 && (
        <p className="hint mg-center">
          {[...hits.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([cup, n]) => `×${formatMultBp(cups[cup] ?? 0)} — ${String(n)}`)
            .join(' · ')}
        </p>
      )}

      {result && !flying && (
        <p className={result.payout >= result.bet ? 'mg-result mg-result--win' : 'mg-result'}>
          {t('minigames.won', { amount: formatMoney(result.payout, result.wallet.currency) })}
        </p>
      )}

      <div className="mg-field">
        <span className="section-label">{t('minigames.plinko.balls', { count: balls })}</span>
        <input
          type="range"
          className="mg-range"
          min={1}
          max={info.plinko.maxBalls}
          value={balls}
          disabled={busy}
          onChange={(e) => {
            setBalls(Number(e.target.value));
          }}
        />
      </div>
      <BetField
        label={t('minigames.betPerBall')}
        wallet={wallet}
        max={maxPerBall}
        shareBp={info.maxBetShareBp}
        input={input}
        onInput={setInput}
        disabled={busy}
      />
      {bet !== null && balls > 1 && (
        <span className="hint">
          {t('minigames.total', { amount: formatMoney(bet * balls, wallet.currency) })}
        </span>
      )}
      <button
        type="button"
        className="button button--primary mg-action"
        disabled={busy || bet === null}
        onClick={onDrop}
      >
        {flying
          ? t('minigames.plinko.dropping')
          : t('minigames.plinko.drop', {
              count: balls,
              amount: formatMoney((bet ?? wallet.minBet) * balls, wallet.currency),
            })}
      </button>

      <Rules
        text={t('minigames.plinko.rules', {
          min: formatMultBp(minMult),
          max: formatMultBp(maxMult),
          rows: info.plinko.difficulties.map((d) => String(d.rows)).join(' / '),
          balls: info.plinko.maxBalls,
        })}
      />
    </>
  );
}
