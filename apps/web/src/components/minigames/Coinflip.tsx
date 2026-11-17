import type { CoinflipResponse, CoinSide } from '@spincards/shared';
import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCoinflip, useMiniGamesRefresh } from '../../api/queries';
import { haptics } from '../../app/telegram';
import { errorText } from '../../lib/errors';
import { formatMoney, formatMultBp } from '../../lib/format';
import { validBet } from '../../lib/money';
import { useToast } from '../../state/toast';
import { BetField } from './BetField';
import { Rules } from './Rules';
import { Segmented } from './Segmented';
import type { MiniGameProps } from './types';

const FLIP_S = 1.4;
const TURNS = 6;

/** D-169 coin: the server flips before the animation; the coin lands on the side it returned. */
export function Coinflip({ info, wallet }: MiniGameProps) {
  const { t } = useTranslation('game');
  const toast = useToast((s) => s.show);
  const refresh = useMiniGamesRefresh();
  const flip = useCoinflip();
  const reduced = useReducedMotion();
  const [side, setSide] = useState<CoinSide>('heads');
  const [input, setInput] = useState('');
  const [result, setResult] = useState<CoinflipResponse | null>(null);
  const [spins, setSpins] = useState(0);
  const [shown, setShown] = useState(true);
  const bet = validBet(input, wallet.minBet, wallet.maxBet);
  const busy = flip.isPending || !shown;
  const sideName = (s: CoinSide) => t(`minigames.coinflip.${s}`);

  const onFlip = () => {
    if (bet === null) return;
    haptics.impact('medium');
    flip.mutate(
      { currency: wallet.currency, bet, side },
      {
        onSuccess: (res) => {
          setResult(res);
          setSpins((n) => n + 1);
          if (reduced) land(res);
          else setShown(false);
        },
        onError: (error) => {
          haptics.notify('error');
          toast(errorText(t, error), 'error');
        },
      },
    );
  };
  const land = (res: CoinflipResponse) => {
    setShown(true);
    refresh();
    haptics.notify(res.payout > 0 ? 'success' : 'error');
  };

  // Whole turns per flip, plus half a turn when tails is up.
  const rotate = spins * TURNS * 360 + (result?.result === 'tails' ? 180 : 0);

  return (
    <>
      <div className="coin-stage">
        <motion.div
          className="coin"
          animate={{ rotateY: rotate }}
          transition={reduced ? { duration: 0 } : { duration: FLIP_S, ease: [0.2, 0.7, 0.3, 1] }}
          onAnimationComplete={() => {
            if (!shown && result) land(result);
          }}
        >
          <div className="coin-face coin-face--heads">{sideName('heads')}</div>
          <div className="coin-face coin-face--tails">{sideName('tails')}</div>
        </motion.div>
      </div>

      {result && shown && (
        <p className={result.payout > 0 ? 'mg-result mg-result--win' : 'mg-result'}>
          {t('minigames.coinflip.result', { side: sideName(result.result).toLowerCase() })}.{' '}
          {result.payout > 0
            ? t('minigames.won', { amount: formatMoney(result.payout, result.wallet.currency) })
            : t('minigames.lost')}
        </p>
      )}

      <div className="mg-field">
        <span className="section-label">{t('minigames.coinflip.pick')}</span>
        <Segmented
          value={side}
          disabled={busy}
          options={(['heads', 'tails'] as const).map((id) => ({ id, label: sideName(id) }))}
          onChange={setSide}
        />
      </div>
      <BetField
        label={t('minigames.bet')}
        wallet={wallet}
        max={wallet.maxBet}
        shareBp={info.maxBetShareBp}
        input={input}
        onInput={setInput}
        disabled={busy}
      />
      <button
        type="button"
        className="button button--primary mg-action"
        disabled={busy || bet === null}
        onClick={onFlip}
      >
        {t('minigames.coinflip.flip', {
          amount: formatMoney(bet ?? wallet.minBet, wallet.currency),
        })}
      </button>

      <Rules
        text={t('minigames.coinflip.rules', { payout: formatMultBp(info.coinflip.payoutBp) })}
      />
    </>
  );
}
