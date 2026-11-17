import type { MiniGameDifficulty, MinesRoundView } from '@spincards/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useMinesCashout,
  useMinesOpen,
  useMinesStart,
  useMiniGamesRefresh,
} from '../../api/queries';
import { haptics } from '../../app/telegram';
import { errorText } from '../../lib/errors';
import { formatMoney, formatMultBp, formatPercentBp } from '../../lib/format';
import { validBet } from '../../lib/money';
import { useToast } from '../../state/toast';
import { BetField } from './BetField';
import { Rules } from './Rules';
import { Segmented } from './Segmented';
import type { MiniGameProps } from './types';

const columns = (cells: number) => (cells <= 12 ? 4 : cells <= 24 ? 6 : 8);

/**
 * D-169 mines: the server lays the mines and the «SpinCards» cell at the start; every opened cell
 * is checked there, the client only shows what came back.
 */
export function Mines({ info, wallet }: MiniGameProps) {
  const { t } = useTranslation('game');
  const toast = useToast((s) => s.show);
  const refresh = useMiniGamesRefresh();
  const start = useMinesStart();
  const open = useMinesOpen();
  const cashout = useMinesCashout();
  const [round, setRound] = useState<MinesRoundView | null>(info.active.mines);
  const [difficulty, setDifficulty] = useState<MiniGameDifficulty>(
    info.active.mines?.difficulty ?? 'easy',
  );
  const board = info.mines.difficulties.find((d) => d.id === difficulty) ??
    info.mines.difficulties[0] ?? { id: 'easy', cells: 12, minMines: 1, maxMines: 1 };
  const [mines, setMines] = useState(board.minMines);
  const [input, setInput] = useState('');
  const busy = start.isPending || open.isPending || cashout.isPending;
  const active = round?.status === 'active';
  const currency = round?.currency ?? wallet.currency;
  const bet = validBet(input, wallet.minBet, wallet.maxBet);
  const minesCount = Math.min(Math.max(mines, board.minMines), board.maxMines);
  const cells = round?.cells ?? board.cells;
  const bonus = formatPercentBp(info.mines.bonusBp);

  const onError = (error: unknown) => {
    haptics.notify('error');
    toast(errorText(t, error), 'error');
  };
  const show = (next: MinesRoundView) => {
    setRound(next);
    if (next.status === 'active') return;
    refresh();
    haptics.notify(next.payout > 0 ? 'success' : 'error');
  };

  const onStart = () => {
    if (bet === null) return;
    start.mutate(
      { currency: wallet.currency, bet, difficulty, mines: minesCount },
      {
        onSuccess: (res) => {
          haptics.impact('light');
          show(res.round);
          refresh();
        },
        onError,
      },
    );
  };
  const onCell = (cell: number) => {
    if (!round || !active || busy || round.opened.includes(cell)) return;
    haptics.select();
    open.mutate(
      { roundId: round.id, cell },
      {
        onSuccess: (res) => {
          if (res.round.bonusFound && !round.bonusFound)
            toast(t('minigames.mines.bonusFound', { bonus }), 'success');
          show(res.round);
        },
        onError,
      },
    );
  };
  const onCashout = () => {
    if (!round) return;
    cashout.mutate(
      { roundId: round.id },
      {
        onSuccess: (res) => {
          show(res.round);
        },
        onError,
      },
    );
  };

  const chanceBp = active
    ? round.safeChanceBp
    : Math.floor(((board.cells - minesCount) * 10_000) / board.cells);
  const current = round ? Math.floor((round.bet * round.multiplierBp) / 10_000) : 0;

  return (
    <>
      {!active && (
        <>
          <div className="mg-field">
            <span className="section-label">{t('minigames.difficulty')}</span>
            <Segmented
              value={difficulty}
              options={info.mines.difficulties.map((d) => ({
                id: d.id,
                label: `${t(`minigames.difficulties.${d.id}`)} · ${String(d.cells)}`,
              }))}
              onChange={(id) => {
                setDifficulty(id);
                setRound(null);
              }}
            />
          </div>
          <div className="mg-field">
            <span className="section-label">
              {t('minigames.mines.minesCount', { count: minesCount })}
            </span>
            <input
              type="range"
              className="mg-range"
              min={board.minMines}
              max={board.maxMines}
              value={minesCount}
              onChange={(e) => {
                setMines(Number(e.target.value));
                setRound(null);
              }}
            />
          </div>
          <BetField
            label={t('minigames.bet')}
            wallet={wallet}
            max={wallet.maxBet}
            shareBp={info.maxBetShareBp}
            input={input}
            onInput={setInput}
          />
        </>
      )}

      <div className="mg-stats">
        <div>
          <span className="hint">{t('minigames.mines.winChance')}</span>
          <strong>{formatPercentBp(chanceBp)}</strong>
          <span className="hint">{t('minigames.mines.winChanceHint')}</span>
        </div>
        {active && (
          <div>
            {round.multiplierBp > 0 && (
              <strong>
                {t('minigames.mines.now', {
                  mult: formatMultBp(round.multiplierBp),
                  amount: formatMoney(current, currency),
                })}
              </strong>
            )}
            {round.nextMultiplierBp !== null && (
              <span className="hint">
                {t('minigames.mines.next', { mult: formatMultBp(round.nextMultiplierBp) })}
              </span>
            )}
          </div>
        )}
      </div>

      <div className={`mines-grid mines-grid--${String(columns(cells))}`} aria-busy={busy}>
        {Array.from({ length: cells }, (_, cell) => {
          const opened = round?.opened.includes(cell) ?? false;
          const isBonus = round?.bonusCell === cell;
          const isMine = round?.minesAt?.includes(cell) ?? false;
          const exploded = round?.exploded === cell;
          const state = exploded
            ? 'exploded'
            : isBonus && (opened || !active)
              ? 'bonus'
              : opened
                ? 'safe'
                : isMine
                  ? 'mine'
                  : 'hidden';
          return (
            <button
              key={cell}
              type="button"
              className={`mines-cell mines-cell--${state}`}
              disabled={!active || opened || busy}
              aria-label={String(cell + 1)}
              onClick={() => {
                onCell(cell);
              }}
            >
              {state === 'bonus' && <span className="mines-bonus">SpinCards</span>}
              {state === 'safe' && <span className="mines-gem" />}
              {(state === 'mine' || state === 'exploded') && <span className="mines-bomb" />}
            </button>
          );
        })}
      </div>

      {round && !active && (
        <p className={round.payout > 0 ? 'mg-result mg-result--win' : 'mg-result'}>
          {round.payout > 0
            ? t('minigames.won', { amount: formatMoney(round.payout, currency) })
            : t('minigames.mines.boom')}
        </p>
      )}

      {active ? (
        <button
          type="button"
          className="button button--primary mg-action"
          disabled={busy || round.opened.length === 0}
          onClick={onCashout}
        >
          {round.opened.length === 0
            ? t('minigames.mines.pickCell')
            : t('minigames.mines.cashout', { amount: formatMoney(current, currency) })}
        </button>
      ) : (
        <button
          type="button"
          className="button button--primary mg-action"
          disabled={busy || bet === null}
          onClick={onStart}
        >
          {t('minigames.mines.start', {
            amount: formatMoney(bet ?? wallet.minBet, wallet.currency),
          })}
        </button>
      )}

      <Rules
        text={t('minigames.mines.rules', {
          bonus,
          edge: formatPercentBp(info.mines.houseEdgeBp),
        })}
      />
    </>
  );
}
