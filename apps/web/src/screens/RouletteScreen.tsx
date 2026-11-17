import {
  batchHasLucky,
  type CardView,
  type MeResponse,
  type PublicConfigResponse,
  type SpinResponse,
} from '@spincards/shared';
import { AnimatePresence, motion } from 'motion/react';
import { type CSSProperties, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import {
  useCashout,
  useCashoutMany,
  useChestClaim,
  useHold,
  useHoldMany,
  useHolder,
  useMe,
  useMiniGames,
  usePublicConfig,
  useSpin,
  useTopup,
} from '../api/queries';
import { haptics } from '../app/telegram';
import { bankLook } from '../components/card/banks';
import { LuckMeter, QuickBonuses } from '../components/Controls';
import { CoachHint } from '../components/CoachHint';
import { InviteBanner } from '../components/InviteBanner';
import { type Decision, ResultPanel } from '../components/ResultPanel';
import { Reveals } from '../components/Reveal';
import { SpinOptions } from '../components/SpinOptions';
import { errorText } from '../lib/errors';
import { formatMoney, formatTime } from '../lib/format';
import { INVITE_BANNER_MIN_SPINS } from '../lib/referral';
import { describeReward } from '../lib/rewards';
import { spinSetup } from '../lib/spinSetup';
import { TUTORIAL_SPINS } from '../lib/tutorial';
import { useNow } from '../lib/useNow';
import { useWalletGuard } from '../lib/useWalletGuard';
import { useNavigation } from '../state/navigation';
import { useSelection } from '../state/selection';
import { useToast } from '../state/toast';
import { useUi } from '../state/ui';

/** Decorative numbers on the idle deck: the kind of numbers players hunt for (not real cards). */
const SHOWCASE_NUMBERS = ['9123 4567 8901 2345', '9000 0000 0000 0009', '9777 7777 7777 7777'];

type Phase =
  | { kind: 'idle' }
  | { kind: 'rolling'; spin: SpinResponse; payCardId: string | null }
  | { kind: 'result'; spin: SpinResponse | null; payCardId: string | null };

export default function RouletteScreen() {
  const me = useMe();
  const config = usePublicConfig();
  const holder = useHolder();
  if (!me.data || !config.data || !holder.data)
    return <div className="screen-loading" aria-busy="true" />;
  return (
    <Roulette
      me={me.data}
      config={config.data}
      cards={holder.data.cards}
      pending={holder.data.pending}
    />
  );
}

interface RouletteProps {
  me: MeResponse;
  config: PublicConfigResponse;
  cards: CardView[];
  pending: CardView[];
}

function Roulette({ me, config, cards, pending }: RouletteProps) {
  const { t } = useTranslation(['game', 'shop']);
  const toast = useToast((s) => s.show);
  const setTab = useNavigation((s) => s.setTab);
  const open = useNavigation((s) => s.open);
  const miniGames = useMiniGames();
  const spin = useSpin();
  const cashout = useCashout();
  const hold = useHold();
  const cashoutMany = useCashoutMany();
  const holdMany = useHoldMany();
  const topup = useTopup();
  const chest = useChestClaim();
  const now = useNow(5000);
  const { coverage, guard } = useWalletGuard();
  const selection = useSelection();
  const { setPack, setPayment, setCount } = selection;
  const { currency, packs, pack, candidates, payCard, maxCount, count, total } = spinSetup(
    me,
    config,
    cards,
    selection,
    now,
  );

  const [current, setPhase] = useState<Phase>({ kind: 'idle' });
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const [skipToken, setSkipToken] = useState(0);

  // Decided ids only grow (card ids are unique), so a holder refetch that still lists a card
  // decided a moment ago can never bring it back on screen.
  const undecided = pending.filter((c) => !decided.has(c.id));
  // Derived phase: a finished result (everything decided) is idle again; undecided cards (after a
  // multi-spin or left from an earlier session) bring the result back.
  const spinCards =
    current.kind === 'result' && current.spin
      ? current.spin.spins.map((s) => s.card).filter((c) => !decided.has(c.id))
      : [];
  let phase: Phase = current;
  if (current.kind === 'result' && current.spin && spinCards.length === 0) phase = { kind: 'idle' };
  // While a spin is in flight the holder is being refetched: never show leftovers from it.
  if (phase.kind === 'idle' && undecided.length > 0 && !spin.isPending)
    phase = { kind: 'result', spin: null, payCardId: null };
  const resultCards = phase.kind === 'result' ? (phase.spin ? spinCards : undecided) : [];

  const setSpinBusy = useUi((s) => s.setSpinBusy);
  useEffect(() => {
    setSpinBusy(phase.kind !== 'idle' || spin.isPending);
    return () => {
      setSpinBusy(false);
    };
  }, [phase.kind, spin.isPending, setSpinBusy]);

  const walletBalance = me.wallets.find((w) => w.currency === currency)?.balance ?? 0;
  const meter = me.game.luckMeters.find((m) => m.packId === pack?.id);
  // The server decides; this only shows it in advance with the same rule (shared luckySource).
  const lucky =
    !!pack &&
    batchHasLucky(
      {
        totalSpins: me.game.totalSpins,
        meter: meter?.value ?? 0,
        meterMax: meter?.max ?? Number.POSITIVE_INFINITY,
        everySpins: me.game.milestone.max,
        freePack: pack.free,
        returnPending: me.game.returnLuckyPending,
      },
      count,
    );
  const banks = config.banks.filter((b) => b.region === me.region);
  const bankName = (id: string) => config.banks.find((b) => b.id === id)?.name;
  const cardLimited = !!payCard && payCard.spinLimit.left === 0;
  const shortOnCard = payCard && !cardLimited ? Math.max(0, total - payCard.balance) : 0;
  // D-166: short on the wallet but the cards can cover it — the spin offers a top-up instead.
  const walletPays = !pack?.free && !payCard;
  const shortOnWallet = walletPays && coverage(currency, total) === 'short';
  const chestReady = me.game.chest.available > 0;

  const fail = (e: unknown) => {
    haptics.notify('error');
    toast(errorText(t, e), 'error');
  };

  const onSpin = () => {
    if (!pack) return;
    if (walletPays && !guard(currency, total)) return;
    haptics.impact('heavy');
    const paymentRequest = payCard
      ? { type: 'card' as const, cardId: payCard.id }
      : { type: 'wallet' as const };
    spin.mutate(
      { packId: pack.id, payment: paymentRequest, count },
      {
        onSuccess: (result) => {
          setSkipToken(0);
          setPhase({ kind: 'rolling', spin: result, payCardId: payCard?.id ?? null });
          // D-133: a new medal is announced right away (the reward is already credited).
          for (const id of result.achievements)
            toast(t('medals.new', { title: t(`achievements.${id}.title`) }), 'success');
        },
        onError: fail,
      },
    );
  };

  const onTopup = () => {
    if (!payCard) return;
    if (walletBalance < shortOnCard) {
      toast(
        t('pay.topupFailed', { amount: formatMoney(shortOnCard - walletBalance, currency) }),
        'error',
      );
      return;
    }
    topup.mutate(
      { cardId: payCard.id, amount: shortOnCard },
      {
        onSuccess: () => {
          haptics.notify('success');
        },
        onError: fail,
      },
    );
  };

  const reveal = () => {
    if (phase.kind !== 'rolling') return;
    const best = phase.spin.spins.some((s) => s.card.tier !== 'common');
    haptics.impact(best ? 'heavy' : 'light');
    haptics.notify('success');
    // D-175: cards of the auto-sell tiers are already in the wallet: no decision for them.
    const sold = phase.spin.spins.filter((s) => s.autoCashedOut);
    if (sold.length > 0) {
      setDecided((prev) => new Set([...prev, ...sold.map((s) => s.card.id)]));
      const amount = sold.reduce((sum, s) => sum + (s.autoCashedOut?.payout ?? 0), 0);
      const toCard = sold[0]?.autoCashedOut?.toCardId;
      const last4 = toCard ? candidates.find((c) => c.id === toCard)?.number.slice(-4) : undefined;
      toast(
        last4
          ? t('result.autoSoldToCard', { amount: formatMoney(amount, currency), last4 })
          : t('result.autoSold', { amount: formatMoney(amount, currency) }),
        'success',
      );
    }
    setPhase({ kind: 'result', spin: phase.spin, payCardId: phase.payCardId });
  };

  // The paying card stays the payout target while it is still held and active.
  const resultPayCard =
    phase.kind === 'result' && phase.payCardId
      ? (candidates.find((c) => c.id === phase.payCardId) ?? null)
      : null;

  const onDecideError = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'HOLDER_FULL') toast(t('result.holderFull'), 'error');
    else fail(e);
  };

  const markDecided = (ids: string[]) => {
    setDecided((prev) => new Set([...prev, ...ids]));
    haptics.notify('success');
  };

  const decide = (cardId: string, decision: Decision) => {
    const toCardId = decision === 'toCard' && resultPayCard ? resultPayCard.id : undefined;
    const done = {
      onSuccess: () => {
        markDecided([cardId]);
      },
      onError: onDecideError,
    };
    if (decision === 'hold') hold.mutate(cardId, done);
    else cashout.mutate(toCardId ? { cardId, toCardId } : { cardId }, done);
  };

  /** Bulk decisions go in one request: all cards or none (D-088). */
  const decideAll = (decision: Decision) => {
    const cardIds = resultCards.map((c) => c.id);
    if (cardIds.length === 0) return;
    const done = {
      onSuccess: () => {
        markDecided(cardIds);
      },
      onError: onDecideError,
    };
    if (decision === 'hold') holdMany.mutate({ cardIds }, done);
    else {
      const toCardId = decision === 'toCard' && resultPayCard ? resultPayCard.id : undefined;
      cashoutMany.mutate(toCardId ? { cardIds, toCardId } : { cardIds }, done);
    }
  };

  const openChest = () => {
    chest.mutate(undefined, {
      onSuccess: (res) => {
        haptics.notify('success');
        toast(
          t('shop:bonuses.chestReward', { reward: describeReward(t, res.reward, currency) }),
          'success',
        );
      },
      onError: fail,
    });
  };

  const idle = phase.kind === 'idle';
  const leveledUpTo =
    phase.kind === 'result' && phase.spin?.exp.leveledUp ? phase.spin.exp.level : null;

  return (
    <div className={`roulette ${idle ? '' : 'is-busy'}`}>
      <div className="roulette-head">
        <div className="head-actions">
          <button
            type="button"
            className="head-action"
            onClick={() => {
              setTab('wallet');
            }}
          >
            <span aria-hidden="true">⇄</span> {t('head.transfer')}
          </button>
          <button
            type="button"
            className="head-action"
            onClick={() => {
              // D-177: straight to the mini-games screen; a known closed flag keeps the old toast.
              if (miniGames.data?.enabled === false) toast(t('head.gamesSoon'));
              else open({ name: 'minigames' });
            }}
          >
            <span aria-hidden="true">✦</span> {t('head.games')}
          </button>
        </div>
        <QuickBonuses chestReady={chestReady} onChest={openChest} busy={chest.isPending} />
      </div>

      <main className="stage">
        <AnimatePresence initial={false}>
          {idle && (
            <motion.div
              key="idle"
              className="stage-layer stage-idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="brand-mark" aria-hidden="true">
                <span className="brand-card" />
                <span className="brand-name">{t('common:appName')}</span>
              </div>

              <div className="stage-deck" aria-hidden="true">
                {banks.slice(0, 3).map((b, i) => {
                  const look = bankLook(b.id);
                  return (
                    <div
                      key={b.id}
                      className={`gc-back gc-back--${config.cardDesign} stage-deck-card stage-deck-card--${String(i)}`}
                      style={
                        {
                          '--bank-from': look.from,
                          '--bank-to': look.to,
                          '--pattern': look.pattern,
                          '--ink': look.ink,
                        } as CSSProperties
                      }
                    >
                      <span className="deck-chip" />
                      <span className="deck-number">
                        {(SHOWCASE_NUMBERS[i] ?? '').split(' ').map((block, b) => (
                          <span key={b}>{block}</span>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>

              {me.game.totalSpins >= INVITE_BANNER_MIN_SPINS && (
                <InviteBanner config={config} referralCode={me.referralCode} currency={currency} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Reveals and results cover everything above the spin row, which never moves (no layout jump). */}
      <AnimatePresence initial={false}>
        {phase.kind === 'rolling' && (
          <motion.div
            key="rolling"
            className="stage-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Reveals
              results={phase.spin.spins.map((s) => s.card)}
              slow={phase.spin.spins.some((s) => s.nearMiss !== null)}
              milestone={phase.spin.spins.some((s) => s.lucky === 'milestone')}
              skipToken={skipToken}
              onDone={reveal}
            />
          </motion.div>
        )}
        {phase.kind === 'result' && resultCards.length > 0 && (
          <motion.div
            key="result"
            className="stage-overlay stage-result"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ResultPanel
              cards={resultCards}
              {...(phase.spin && { items: phase.spin.spins, expGained: phase.spin.exp.gained })}
              leveledUpTo={leveledUpTo}
              payCard={resultPayCard}
              holderName={me.firstName}
              bankName={bankName}
              referralCode={me.referralCode}
              beginner={me.game.totalSpins <= TUTORIAL_SPINS}
              onDecide={decide}
              onDecideAll={decideAll}
              busy={
                cashout.isPending || hold.isPending || cashoutMany.isPending || holdMany.isPending
              }
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tap anywhere skips the reveal (TZ 13). */}
      {phase.kind === 'rolling' && (
        <button
          type="button"
          className="skip-catcher"
          aria-label={t('spin.skip')}
          onClick={() => {
            setSkipToken((n) => n + 1);
          }}
        />
      )}

      <section className="controls">
        <div className="controls-upper" aria-hidden={!idle} inert={!idle}>
          {idle && (
            <CoachHint
              totalSpins={me.game.totalSpins}
              paidPack={!!pack && !pack.free}
              payableCards={candidates.filter((c) => c.spinLimit.left > 0).length}
              payingWithCard={!!payCard}
            />
          )}
          <div className="meters">
            {meter && <LuckMeter value={meter.value} max={meter.max} />}
            <LuckMeter
              kind="milestone"
              value={me.game.milestone.value}
              max={me.game.milestone.max}
            />
          </div>
          <SpinOptions
            me={me}
            packs={packs}
            pack={pack}
            onPack={setPack}
            count={count}
            maxCount={maxCount}
            onCount={setCount}
            cards={candidates}
            payCard={payCard}
            total={total}
            onPayment={setPayment}
            walletBalance={walletBalance}
            currency={currency}
            bankName={bankName}
            disabled={spin.isPending}
          />
        </div>
        <div className="spin-row" inert={!idle}>
          {cardLimited ? (
            <button type="button" className="spin-button" disabled>
              {payCard.spinLimit.resetsAt
                ? t('pay.cardLimitUntil', { time: formatTime(payCard.spinLimit.resetsAt) })
                : t('pay.cardLimit')}
            </button>
          ) : shortOnCard > 0 ? (
            <button
              type="button"
              className="spin-button spin-button--topup"
              onClick={onTopup}
              disabled={topup.isPending}
            >
              {t('pay.topupCard', { amount: formatMoney(shortOnCard, currency) })}
            </button>
          ) : (
            <button
              type="button"
              className={`spin-button ${spin.isPending ? 'is-busy' : ''} ${lucky ? 'spin-button--lucky' : ''}`}
              onClick={onSpin}
              disabled={!pack || shortOnWallet || spin.isPending}
            >
              {spin.isPending ? (
                t('spin.printing')
              ) : (
                <>
                  {lucky
                    ? count > 1
                      ? t('spin.luckyMany', { count })
                      : t('spin.lucky')
                    : count > 1
                      ? t('spin.buttonMany', { count })
                      : t('spin.button')}{' '}
                  <span className="sum">
                    {pack?.free ? t('spin.free') : formatMoney(total, currency)}
                  </span>
                </>
              )}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
