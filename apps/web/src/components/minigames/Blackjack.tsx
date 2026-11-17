import type { BlackjackRoundView } from '@spincards/shared';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlackjackAct, useBlackjackStart, useMiniGamesRefresh } from '../../api/queries';
import { haptics } from '../../app/telegram';
import { errorText } from '../../lib/errors';
import { formatMoney, formatMultBp } from '../../lib/format';
import { validBet } from '../../lib/money';
import { useToast } from '../../state/toast';
import { BetField } from './BetField';
import { Rules } from './Rules';
import type { MiniGameProps } from './types';

const SUITS = ['♠', '♥', '♦', '♣'] as const;

/**
 * D-169 21: the shoe is shuffled on the server at the deal; the dealer's second card stays there
 * until the hand is over.
 */
export function Blackjack({ info, wallet }: MiniGameProps) {
  const { t } = useTranslation('game');
  const toast = useToast((s) => s.show);
  const refresh = useMiniGamesRefresh();
  const deal = useBlackjackStart();
  const act = useBlackjackAct();
  const [round, setRound] = useState<BlackjackRoundView | null>(info.active.blackjack);
  const [input, setInput] = useState('');
  const bet = validBet(input, wallet.minBet, wallet.maxBet);
  const busy = deal.isPending || act.isPending;
  const active = round?.status === 'active';
  const currency = round?.currency ?? wallet.currency;
  const ranks = t('minigames.blackjack.ranks').split(',');

  const onError = (error: unknown) => {
    haptics.notify('error');
    toast(errorText(t, error), 'error');
  };
  const show = (next: BlackjackRoundView) => {
    setRound(next);
    refresh();
    if (next.status === 'active') return;
    haptics.notify(next.outcome === 'lose' ? 'error' : 'success');
  };
  const onDeal = () => {
    if (bet === null) return;
    haptics.impact('light');
    deal.mutate(
      { currency: wallet.currency, bet },
      {
        onSuccess: (res) => {
          show(res.round);
        },
        onError,
      },
    );
  };
  const onAct = (action: 'hit' | 'stand' | 'double') => {
    if (!round) return;
    haptics.select();
    act.mutate(
      { roundId: round.id, action },
      {
        onSuccess: (res) => {
          show(res.round);
        },
        onError,
      },
    );
  };

  const card = (c: number, key: string) => {
    const suit = Math.floor(c / 13);
    return (
      <motion.div
        key={key}
        className={`pcard ${suit === 1 || suit === 2 ? 'pcard--red' : ''}`}
        initial={{ y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <span>{ranks[c % 13]}</span>
        <span>{SUITS[suit]}</span>
      </motion.div>
    );
  };

  return (
    <>
      <div className="bj-table">
        <div className="bj-hand">
          <span className="section-label">
            {t('minigames.blackjack.dealer')}
            {round?.dealerTotal != null &&
              ` · ${t('minigames.blackjack.total', { total: round.dealerTotal })}`}
          </span>
          <div className="bj-cards">
            {round?.dealer.map((c, i) => card(c, `d${String(i)}`))}
            {active && (
              <div className="pcard pcard--back" aria-label={t('minigames.blackjack.hidden')} />
            )}
          </div>
        </div>
        <div className="bj-hand">
          <span className="section-label">
            {t('minigames.blackjack.you')}
            {round && ` · ${t('minigames.blackjack.total', { total: round.playerTotal })}`}
          </span>
          <div className="bj-cards">{round?.player.map((c, i) => card(c, `p${String(i)}`))}</div>
        </div>
      </div>

      {round?.outcome && (
        <p className={round.outcome === 'lose' ? 'mg-result' : 'mg-result mg-result--win'}>
          {t(`minigames.blackjack.outcomes.${round.outcome}`, {
            amount: formatMoney(round.payout, currency),
          })}
        </p>
      )}

      {active ? (
        <div className="bj-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              onAct('hit');
            }}
          >
            {t('minigames.blackjack.hit')}
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => {
              onAct('stand');
            }}
          >
            {t('minigames.blackjack.stand')}
          </button>
          {round.canDouble && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                onAct('double');
              }}
            >
              {t('minigames.blackjack.double')}
            </button>
          )}
        </div>
      ) : (
        <>
          <BetField
            label={t('minigames.bet')}
            wallet={wallet}
            max={wallet.maxBet}
            shareBp={info.maxBetShareBp}
            input={input}
            onInput={setInput}
          />
          <button
            type="button"
            className="button button--primary mg-action"
            disabled={busy || bet === null}
            onClick={onDeal}
          >
            {t('minigames.blackjack.deal', {
              amount: formatMoney(bet ?? wallet.minBet, wallet.currency),
            })}
          </button>
        </>
      )}

      <Rules
        text={t('minigames.blackjack.rules', {
          blackjack: formatMultBp(info.blackjack.blackjackPayoutBp),
          decks: info.blackjack.decks,
        })}
      />
    </>
  );
}
