import {
  type CardView,
  isUpgradeTier,
  nextTier,
  type Currency,
  lifecyclePrices,
  type MeResponse,
  type PublicConfigResponse,
  type TransferEndpoint,
} from '@spincards/shared';
import { AnimatePresence, motion } from 'motion/react';
import { type CSSProperties, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCardAction,
  useCashout,
  useHolder,
  useMe,
  usePublicConfig,
  useTransfer,
  useTrophy,
} from '../api/queries';
import { haptics } from '../app/telegram';
import { AmountPresets } from '../components/AmountPresets';
import { Card } from '../components/card/Card';
import { OverlayScreen, Sheet } from '../components/Overlay';
import { errorText } from '../lib/errors';
import { formatMoney, formatPercentBp, formatTime } from '../lib/format';
import { parseMajorToMinor } from '../lib/money';
import { useNow } from '../lib/useNow';
import { useWalletGuard } from '../lib/useWalletGuard';
import { useTilt } from '../lib/useTilt';
import { useNavigation } from '../state/navigation';
import { useToast } from '../state/toast';
import { LifeLine } from './HolderScreen';
import { CollectButton } from '../components/CollectButton';
import { StarsButton } from '../components/StarsButton';

export default function CardScreen({ cardId }: { cardId: string }) {
  const { t } = useTranslation('game');
  const me = useMe();
  const holder = useHolder();
  const config = usePublicConfig();
  const card =
    holder.data?.cards.find((c) => c.id === cardId) ??
    holder.data?.pending.find((c) => c.id === cardId);
  return (
    <OverlayScreen title={card ? t(`tiers.${card.tier}`) : ''}>
      {me.data && config.data && card ? (
        <CardDetail
          card={card}
          me={me.data}
          config={config.data}
          others={(holder.data?.cards ?? []).filter(
            (c) => c.id !== card.id && c.currency === card.currency && c.status === 'active',
          )}
        />
      ) : (
        <div className="screen-loading" aria-busy="true" />
      )}
    </OverlayScreen>
  );
}

function CardDetail({
  card,
  me,
  config,
  others,
}: {
  card: CardView;
  me: MeResponse;
  config: PublicConfigResponse;
  /** Other active held cards of the same currency: card→card transfer targets. */
  others: CardView[];
}) {
  const { t } = useTranslation(['game', 'common']);
  const toast = useToast((s) => s.show);
  const back = useNavigation((s) => s.back);
  const open = useNavigation((s) => s.open);
  const tilt = useTilt();
  const now = useNow();
  const [sheet, setSheet] = useState<'topup' | 'send' | 'cashout' | 'trophy' | null>(null);
  const trophy = useTrophy();
  const extend = useCardAction('extend');
  const restore = useCardAction('restore');
  const { guard } = useWalletGuard();
  const cashout = useCashout();

  const currency = card.currency as Currency;
  const expired = card.status === 'expired' || Date.parse(card.expiresAt) <= now;
  const lifespanHours = config.tiers.find((x) => x.tier === card.tier)?.lifespanHours ?? 0;
  // Luck from the tier and from the number's rarity (patterns), shown separately.
  const tierLuck = config.tiers.find((x) => x.tier === card.tier)?.cardLuckPoints ?? 0;
  // Prices by rarity, paid from the wallet (D-115).
  const { extendLifespanBp } = config.lifecycle;
  const prices = lifecyclePrices(card, currency, config.lifecycle);
  const extendFee = prices.extend;
  const restoreFee = prices.restore;
  const bankName = config.banks.find((b) => b.id === card.bankId)?.name;
  const busy = extend.isPending || restore.isPending || cashout.isPending || trophy.isPending;

  const onError = (e: unknown) => {
    haptics.notify('error');
    toast(errorText(t, e), 'error');
  };
  const done = () => {
    haptics.notify('success');
    toast(t('cardDetail.done'), 'success');
  };

  return (
    <div className="card-detail">
      <motion.div
        className="card-detail-card"
        style={tilt.style}
        onPointerMove={tilt.onPointerMove}
        onPointerLeave={tilt.onPointerLeave}
      >
        <Card
          card={card}
          holderName={me.firstName}
          {...(bankName && { bankName })}
          style={{ '--card-width': 'min(88vw, 340px)' } as CSSProperties}
        />
      </motion.div>
      {tilt.gyro === 'needs-permission' && (
        <button type="button" className="link-button" onClick={() => void tilt.enableGyro()}>
          {t('cardDetail.enableGyro')}
        </button>
      )}

      <dl className="facts">
        <Fact label={t('card.balance')} value={formatMoney(card.balance, currency)} strong />
        <Fact label={t('cardDetail.rarity')} value={String(card.rarityScore)} />
        <Fact label={t('cardDetail.owners')} value={String(card.ownersCount)} />
        <Fact
          label={t('cardDetail.luck')}
          value={t('cardDetail.luckValue', { points: card.luckPoints, max: config.luck.maxPoints })}
          detail={t('cardDetail.luckParts', {
            tier: tierLuck,
            number: Math.max(0, card.luckPoints - tierLuck),
          })}
        />
        {card.held && !expired && (
          <Fact
            label={t('cardDetail.spinLimit')}
            value={t('cardDetail.spinLimitValue', {
              left: card.spinLimit.left,
              max: card.spinLimit.max,
            })}
            {...(card.spinLimit.resetsAt && {
              detail: t('cardDetail.spinLimitResets', {
                time: formatTime(card.spinLimit.resetsAt),
              }),
            })}
          />
        )}
        <div className="fact fact--wide">
          <dt>{expired ? t('cardDetail.grace') : t('cardDetail.lifetime')}</dt>
          <dd>
            <LifeLine card={card} />
          </dd>
        </div>
      </dl>

      <div className="actions">
        {!expired && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              setSheet('topup');
            }}
          >
            {t('cardDetail.topup')}
          </button>
        )}
        {!expired && (
          <button
            type="button"
            className="button"
            disabled={busy || card.balance === 0}
            onClick={() => {
              setSheet('send');
            }}
          >
            {t('transfer.button')}
          </button>
        )}
        {!expired && (
          <button
            type="button"
            className="button"
            disabled={busy || card.extendedCount > 0}
            onClick={() => {
              if (!guard(currency, extendFee)) return;
              extend.mutate(card.id, { onSuccess: done, onError });
            }}
          >
            {card.extendedCount > 0
              ? t('cardDetail.extended')
              : t('cardDetail.extend', { fee: formatMoney(extendFee, currency) })}
          </button>
        )}
        {!expired && card.extendedCount === 0 && (
          <span className="hint actions-hint">
            {t('cardDetail.extendHint', {
              hours: Math.floor((lifespanHours * extendLifespanBp) / 10_000),
            })}
          </span>
        )}
        {expired && (
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => {
              if (!guard(currency, restoreFee)) return;
              restore.mutate(card.id, { onSuccess: done, onError });
            }}
          >
            {t('cardDetail.restore', { fee: formatMoney(restoreFee, currency) })}
          </button>
        )}
        <button
          type="button"
          className="button button--gold"
          disabled={busy}
          onClick={() => {
            setSheet('trophy');
          }}
        >
          {t('album.save', { price: formatMoney(card.trophyPrice, currency) })}
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={busy}
          onClick={() => {
            setSheet('cashout');
          }}
        >
          {t('cardDetail.cashout', { amount: formatMoney(card.cashoutValue, currency) })}
        </button>
        {expired && <span className="hint actions-hint">{t('cardDetail.expiredCashoutHint')}</span>}
      </div>
      {config.stars && (
        <section className="section">
          <span className="section-label">{t('cardStars.title')}</span>
          <div className="actions">
            {card.held && card.spinLimit.left < card.spinLimit.max && (
              <StarsButton
                productId="card_limit_reset"
                cardId={card.id}
                stars={config.stars.cardLimitReset}
                label={t('cardStars.reset')}
                className="button button--stars"
              />
            )}
            {!expired && card.extendedCount > 0 && (
              <StarsButton
                productId="card_extend"
                cardId={card.id}
                stars={config.stars.cardExtend[card.tier]}
                label={t('cardStars.extend')}
                className="button button--stars"
              />
            )}
            <StarsButton
              productId="trophy"
              cardId={card.id}
              stars={config.stars.trophy[card.tier]}
              label={t('cardStars.trophy')}
              className="button button--stars"
            />
            {!expired && config.stars.cardUpgrade && isUpgradeTier(card.tier) && (
              <StarsButton
                productId="card_upgrade"
                cardId={card.id}
                stars={config.stars.cardUpgrade[card.tier]}
                label={t('cardStars.upgrade', {
                  tier: t(`tiers.${nextTier(card.tier) ?? card.tier}`),
                })}
                className="button button--stars"
              />
            )}
            <button
              type="button"
              className="button"
              onClick={() => {
                haptics.select();
                open({ name: 'shop', cardId: card.id });
              }}
            >
              {t('cardStars.inShop')}
            </button>
          </div>
        </section>
      )}

      <AnimatePresence>
        {(sheet === 'topup' || sheet === 'send') && (
          <TransferSheet
            mode={sheet}
            card={card}
            others={others}
            walletBalance={me.wallets.find((w) => w.currency === currency)?.balance ?? 0}
            cashoutFeeBp={me.game.cashoutFeeBp}
            cardToCardFeeBp={config.transfer.cardToCardFeeBp}
            onClose={() => {
              setSheet(null);
            }}
          />
        )}
        {sheet === 'trophy' && (
          <Sheet
            onClose={() => {
              setSheet(null);
            }}
          >
            <p className="sheet-text">
              {t('album.saveConfirm', {
                price: formatMoney(card.trophyPrice, currency),
                payout: formatMoney(card.cashoutValue, currency),
              })}
            </p>
            <div className="sheet-actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  setSheet(null);
                }}
              >
                {t('common:cancel')}
              </button>
              <button
                type="button"
                className="button button--gold"
                disabled={trophy.isPending}
                onClick={() => {
                  trophy.mutate(card.id, {
                    onSuccess: () => {
                      haptics.notify('success');
                      toast(t('album.saved'), 'success');
                      setSheet(null);
                      back();
                    },
                    onError,
                  });
                }}
              >
                {t('album.saveShort')}
              </button>
            </div>
          </Sheet>
        )}
        {sheet === 'cashout' && (
          <Sheet
            onClose={() => {
              setSheet(null);
            }}
          >
            <p className="sheet-text">{t('cardDetail.cashoutConfirm')}</p>
            <div className="sheet-actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  setSheet(null);
                }}
              >
                {t('common:cancel')}
              </button>
              <button
                type="button"
                className="button button--danger"
                disabled={cashout.isPending}
                onClick={() => {
                  cashout.mutate(
                    { cardId: card.id },
                    {
                      onSuccess: (res) => {
                        haptics.notify('success');
                        toast(
                          t('result.cashedOut', {
                            amount: formatMoney(res.payout, card.currency),
                          }),
                          'success',
                        );
                        setSheet(null);
                        back();
                      },
                      onError,
                    },
                  );
                }}
              >
                {t('cardDetail.cashout', { amount: formatMoney(card.cashoutValue, currency) })}
              </button>
            </div>
          </Sheet>
        )}
      </AnimatePresence>
    </div>
  );
}

function Fact({
  label,
  value,
  strong = false,
  detail,
}: {
  label: string;
  value: string;
  strong?: boolean;
  detail?: string;
}) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd className={strong ? 'fact-strong' : ''}>
        {value}
        {detail && <span className="fact-detail">{detail}</span>}
      </dd>
    </div>
  );
}

/** The other end of a transfer: the wallet or another held card. */
type Counterpart = { type: 'wallet' } | { type: 'card'; card: CardView };

/**
 * Transfers (D-088). «Пополнить»: the player picks where the money comes from (wallet free, another
 * card with the card-to-card fee). «Перевести»: the player picks where it goes (wallet with the level
 * cash-out fee, the card stays held; another card with the card-to-card fee). The fee is shown first.
 */
function TransferSheet({
  mode,
  card,
  others,
  walletBalance,
  cashoutFeeBp,
  cardToCardFeeBp,
  onClose,
}: {
  mode: 'topup' | 'send';
  card: CardView;
  others: CardView[];
  walletBalance: number;
  cashoutFeeBp: number;
  cardToCardFeeBp: number;
  onClose: () => void;
}) {
  const { t } = useTranslation(['game', 'common']);
  const toast = useToast((s) => s.show);
  const transfer = useTransfer();
  // Top-up sources: the wallet always first (even when empty), then cards with money, richest
  // first; empty cards last and disabled. Destinations keep the holder order.
  const cardOptions =
    mode === 'topup'
      ? [...others].sort(
          (a, b) => Number(b.balance > 0) - Number(a.balance > 0) || b.balance - a.balance,
        )
      : others;
  const firstFunded = cardOptions.find((c) => c.balance > 0);
  const [other, setOther] = useState<Counterpart>(() =>
    mode === 'topup' && walletBalance === 0 && firstFunded
      ? { type: 'card', card: firstFunded }
      : { type: 'wallet' },
  );
  const [input, setInput] = useState('');
  const amount = parseMajorToMinor(input);
  const topup = mode === 'topup';
  const otherBalance = other.type === 'wallet' ? walletBalance : other.card.balance;
  const source = topup ? otherBalance : card.balance;
  const feeBp = other.type === 'card' ? cardToCardFeeBp : topup ? 0 : cashoutFeeBp;
  const fee = amount ? Math.ceil((amount * feeBp) / 10_000) : 0;
  const received = amount ? amount - fee : 0;
  const valid = amount !== null && amount > 0 && amount <= source && received > 0;

  const self: TransferEndpoint = { type: 'card', cardId: card.id };
  const otherEnd: TransferEndpoint =
    other.type === 'wallet' ? { type: 'wallet' } : { type: 'card', cardId: other.card.id };
  const ends = topup ? { from: otherEnd, to: self } : { from: self, to: otherEnd };

  const options: {
    key: string;
    value: Counterpart;
    label: string;
    balance: number;
    empty?: boolean;
  }[] = [
    {
      key: 'wallet',
      value: { type: 'wallet' },
      label: t('transfer.wallet'),
      balance: walletBalance,
    },
    ...cardOptions.map((c) => ({
      key: c.id,
      value: { type: 'card' as const, card: c },
      label: t('transfer.card', { last4: c.number.slice(-4) }),
      balance: c.balance,
      empty: mode === 'topup' && c.balance === 0,
    })),
  ];
  const isActive = (v: Counterpart) =>
    v.type === other.type &&
    (v.type === 'wallet' || (other.type === 'card' && v.card.id === other.card.id));

  return (
    <Sheet onClose={onClose}>
      <h3>
        {topup
          ? t('transfer.topupTitle', { last4: card.number.slice(-4) })
          : t('transfer.sendTitle', { last4: card.number.slice(-4) })}
      </h3>
      <span className="section-label">{topup ? t('transfer.from') : t('transfer.to')}</span>
      <div
        className="payment-options transfer-options"
        role="radiogroup"
        aria-label={topup ? t('transfer.from') : t('transfer.to')}
      >
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={isActive(o.value)}
            className={`payment-option ${isActive(o.value) ? 'is-active' : ''} ${o.empty ? 'is-empty' : ''}`}
            disabled={o.empty}
            onClick={() => {
              setOther(o.value);
              setInput('');
            }}
          >
            <span>{o.label}</span>
            <span className="payment-detail">{formatMoney(o.balance, card.currency)}</span>
          </button>
        ))}
      </div>
      {topup && others.some((o) => o.balance > 0) && (
        <CollectButton
          currency={card.currency as Currency}
          to={{ type: 'card', cardId: card.id }}
          label={t('collect.toCard')}
          onDone={onClose}
        />
      )}
      <input
        className="input"
        inputMode="decimal"
        placeholder={t('cardDetail.amount')}
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
        }}
      />
      <AmountPresets currency={card.currency} max={source} input={input} onInput={setInput} />
      <p className="hint transfer-fee">
        {feeBp === 0
          ? t('transfer.noFee')
          : t('transfer.fee', {
              fee: `${formatMoney(fee, card.currency)} (${formatPercentBp(feeBp)})`,
              received: formatMoney(received, card.currency),
            })}
      </p>
      <button
        type="button"
        className="button button--primary"
        disabled={!valid || transfer.isPending}
        onClick={() => {
          if (!amount) return;
          transfer.mutate(
            { ...ends, amount },
            {
              onSuccess: (res) => {
                haptics.notify('success');
                toast(
                  t('transfer.done', { amount: formatMoney(res.received, card.currency) }),
                  'success',
                );
                onClose();
              },
              onError: (e) => {
                haptics.notify('error');
                toast(errorText(t, e), 'error');
              },
            },
          );
        }}
      >
        {topup ? t('cardDetail.topup') : t('transfer.button')}
      </button>
    </Sheet>
  );
}
