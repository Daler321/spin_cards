import {
  type Currency,
  CURRENCIES,
  HISTORY_GROUPS,
  HISTORY_PERIODS,
  type HistoryFilter,
  type HistoryGroup,
  type MeResponse,
  type PublicConfigResponse,
} from '@spincards/shared';
import { AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useConvert,
  useHistory,
  useMe,
  useP2pSend,
  usePublicConfig,
  useRecipient,
} from '../api/queries';
import { haptics } from '../app/telegram';
import { AmountPresets } from '../components/AmountPresets';
import { previewConversion } from '../lib/conversion';
import { errorText } from '../lib/errors';
import { currencySymbol, formatMoney, formatPercentBp, LOCALE } from '../lib/format';
import { parseMajorToMinor, regionCurrency } from '../lib/money';
import { Sheet } from '../components/Overlay';
import { WalletTopup } from '../components/WalletTopup';
import { useToast } from '../state/toast';
import { ScrollStrip } from '../components/ScrollStrip';

// History is not a tab: it always sits at the bottom of the wallet.
const OPERATIONS = ['send', 'convert'] as const;
type Operation = (typeof OPERATIONS)[number];

export default function WalletScreen() {
  const { t } = useTranslation('shop');
  const me = useMe();
  const config = usePublicConfig();
  const [operation, setOperation] = useState<Operation>('send');
  const [topup, setTopup] = useState<Currency | null>(null);
  if (!me.data || !config.data) return <div className="screen-loading" aria-busy="true" />;
  return (
    <div className="page">
      <div className="page-head">
        <h2>{t('wallet.title')}</h2>
      </div>
      <div className="balances">
        {me.data.wallets.map((w) => (
          <button
            key={w.currency}
            type="button"
            className="balance-card"
            aria-label={t('wallet.topupOpen', { amount: formatMoney(w.balance, w.currency) })}
            onClick={() => {
              haptics.select();
              setTopup(CURRENCIES.find((c) => c === w.currency) ?? null);
            }}
          >
            <span className="hint">{w.currency}</span>
            <strong>{formatMoney(w.balance, w.currency)}</strong>
            <span className="balance-card-action">{t('wallet.topup')}</span>
          </button>
        ))}
      </div>
      <div
        className="segmented segmented--wide"
        role="radiogroup"
        aria-label={t('wallet.operation')}
      >
        {OPERATIONS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={operation === id}
            className={operation === id ? 'is-active' : ''}
            onClick={() => {
              haptics.select();
              setOperation(id);
            }}
          >
            {t(`wallet.operations.${id}`)}
          </button>
        ))}
      </div>
      {operation === 'send' && <SendToPlayer me={me.data} config={config.data} />}
      {operation === 'convert' && <Converter me={me.data} config={config.data} />}
      <History />
      <AnimatePresence>
        {topup && (
          <Sheet
            onClose={() => {
              setTopup(null);
            }}
          >
            <h3>{t('wallet.topupTitle', { currency: currencySymbol(topup) })}</h3>
            <WalletTopup
              me={me.data}
              currency={topup}
              onDone={() => {
                setTopup(null);
              }}
            />
          </Sheet>
        )}
      </AnimatePresence>
    </div>
  );
}

function Converter({ me, config }: { me: MeResponse; config: PublicConfigResponse }) {
  const { t } = useTranslation('shop');
  const toast = useToast((s) => s.show);
  const convert = useConvert();
  const [from, setFrom] = useState<Currency>(me.region === 'US' ? 'USD' : 'RUB');
  const [input, setInput] = useState('');
  const to: Currency = from === 'RUB' ? 'USD' : 'RUB';
  const amount = parseMajorToMinor(input);
  const preview = amount ? previewConversion(config, from, to, amount) : null;
  const balance = me.wallets.find((w) => w.currency === from)?.balance ?? 0;
  const rateInfo = previewConversion(config, from, to, 1_000_000);

  return (
    <section className="section">
      <div className="converter">
        <div className="segmented segmented--wide" role="radiogroup" aria-label={t('wallet.from')}>
          {(['RUB', 'USD'] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={from === c}
              className={from === c ? 'is-active' : ''}
              onClick={() => {
                setFrom(c);
                setInput('');
              }}
            >
              {c} → {c === 'RUB' ? 'USD' : 'RUB'}
            </button>
          ))}
        </div>
        <input
          className="input"
          inputMode="decimal"
          placeholder={t('wallet.amount')}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
          }}
        />
        <AmountPresets currency={from} max={balance} input={input} onInput={setInput} />
        <div className="converter-info">
          {rateInfo && (
            <span className="hint">
              {t('wallet.rate', {
                from,
                to,
                rate: new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 4 }).format(
                  rateInfo.rate,
                ),
              })}
            </span>
          )}
          <span className="hint">
            {t('wallet.minAmount', {
              amount: formatMoney(config.conversion.minAmount[from], from),
            })}
          </span>
          {preview && !preview.belowMinimum && (
            <>
              <span className="hint">
                {t('wallet.fee', { fee: formatMoney(preview.fee, from) })}
              </span>
              <strong>{t('wallet.result', { amount: formatMoney(preview.result, to) })}</strong>
            </>
          )}
        </div>
        <button
          type="button"
          className="button button--primary"
          disabled={
            !amount || !preview || preview.belowMinimum || amount > balance || convert.isPending
          }
          onClick={() => {
            if (!amount) return;
            convert.mutate(
              { from, to, amount },
              {
                onSuccess: (res) => {
                  haptics.notify('success');
                  toast(
                    t('wallet.converted', { amount: formatMoney(res.amountTo, res.to) }),
                    'success',
                  );
                  setInput('');
                },
                onError: (e) => {
                  haptics.notify('error');
                  toast(errorText(t, e), 'error');
                },
              },
            );
          }}
        >
          {t('wallet.convertButton')}
        </button>
      </div>
    </section>
  );
}

function History() {
  const { t } = useTranslation(['shop', 'common']);
  const [filter, setFilter] = useState<HistoryFilter>({});
  const history = useHistory(filter);
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];
  const chip = (active: boolean, label: string, onClick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={active}
      className={`chip-button ${active ? 'is-active' : 'chip-button--ghost'}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
  return (
    <section className="section">
      <h3>{t('wallet.history')}</h3>
      <div className="history-filters">
        <ScrollStrip className="chips" role="radiogroup" aria-label={t('historyFilter.type')}>
          {chip(
            !filter.group,
            t('historyFilter.all'),
            () => {
              setFilter(({ group: _, ...rest }) => rest);
            },
            'all',
          )}
          {(Object.keys(HISTORY_GROUPS) as HistoryGroup[]).map((group) =>
            chip(
              filter.group === group,
              t(`historyFilter.groups.${group}`),
              () => {
                setFilter((f) => ({ ...f, group }));
              },
              group,
            ),
          )}
        </ScrollStrip>
        <ScrollStrip className="chips" role="radiogroup" aria-label={t('historyFilter.period')}>
          {chip(
            !filter.days,
            t('historyFilter.anyTime'),
            () => {
              setFilter(({ days: _, ...rest }) => rest);
            },
            'any',
          )}
          {HISTORY_PERIODS.map((days) =>
            chip(
              filter.days === days,
              t('historyFilter.days', { count: days }),
              () => {
                setFilter((f) => ({ ...f, days }));
              },
              String(days),
            ),
          )}
          <span className="chips-gap" />
          {chip(
            !filter.currency,
            t('historyFilter.allCurrencies'),
            () => {
              setFilter(({ currency: _, ...rest }) => rest);
            },
            'cur-all',
          )}
          {CURRENCIES.map((currency) =>
            chip(
              filter.currency === currency,
              currencySymbol(currency),
              () => {
                setFilter((f) => ({ ...f, currency }));
              },
              currency,
            ),
          )}
        </ScrollStrip>
      </div>
      {items.length === 0 && !history.isLoading && <p className="empty">{t('common:empty')}</p>}
      <div className="list">
        {items.map((item) => (
          <div key={item.id} className="list-row">
            <div className="list-main">
              <strong>{t(`reasons.${item.reason}`, { defaultValue: item.reason })}</strong>
              <span className="hint">
                {new Intl.DateTimeFormat(LOCALE, {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(item.createdAt))}
              </span>
            </div>
            <span className={`amount ${item.delta > 0 ? 'amount--in' : 'amount--out'}`}>
              {item.delta > 0 ? '+' : '−'}
              {formatMoney(Math.abs(item.delta), item.currency)}
            </span>
          </div>
        ))}
      </div>
      {history.hasNextPage && (
        <button
          type="button"
          className="button"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {t('common:showMore')}
        </button>
      )}
    </section>
  );
}

/** D-131: money to another player by @username, with the fee and the limit shown up front. */
function SendToPlayer({ me, config }: { me: MeResponse; config: PublicConfigResponse }) {
  const { t } = useTranslation('shop');
  const toast = useToast((s) => s.show);
  const send = useP2pSend();
  const currency = regionCurrency(me.region);
  const rules = config.p2p;
  const [name, setName] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const recipient = useRecipient(asked);
  const amount = parseMajorToMinor(input);
  const fee = amount ? Math.ceil((amount * rules.feeBp) / 10_000) : 0;
  const balance = me.wallets.find((w) => w.currency === currency)?.balance ?? 0;
  const locked = me.level < rules.minLevel;
  const ok =
    !!recipient.data && !!amount && amount >= rules.minAmount[currency] && amount <= balance;

  return (
    <section className="section">
      <p className="hint">
        {t('p2p.hint', {
          fee: formatPercentBp(rules.feeBp),
          limit: formatMoney(rules.dailyLimit[currency], currency),
          level: rules.minLevel,
        })}
      </p>
      <form
        className="row-form"
        onSubmit={(e) => {
          e.preventDefault();
          const clean = name.trim().replace(/^@/, '');
          if (clean.length >= 3) setAsked(clean);
        }}
      >
        <input
          className="input"
          value={name}
          placeholder={t('p2p.username')}
          autoCapitalize="none"
          autoCorrect="off"
          disabled={locked}
          onChange={(e) => {
            setName(e.target.value);
            setAsked(null);
          }}
        />
        <button type="submit" className="button" disabled={locked || name.trim().length < 3}>
          {t('p2p.find')}
        </button>
      </form>
      {recipient.isError && <p className="hint">{errorText(t, recipient.error)}</p>}
      {recipient.data && (
        <div className="p2p-recipient">
          {recipient.data.photoUrl ? (
            <img className="avatar avatar--small" src={recipient.data.photoUrl} alt="" />
          ) : (
            <span className="avatar avatar--small avatar--initial">
              {recipient.data.firstName.slice(0, 1)}
            </span>
          )}
          <span>
            <b>{recipient.data.firstName}</b> @{recipient.data.username} ·{' '}
            {t('p2p.level', { level: recipient.data.level })}
          </span>
        </div>
      )}
      {recipient.data && (
        <>
          <input
            className="input"
            inputMode="decimal"
            value={input}
            placeholder={t('p2p.amount')}
            onChange={(e) => {
              setInput(e.target.value);
            }}
          />
          <AmountPresets currency={currency} max={balance} input={input} onInput={setInput} />
          {amount ? (
            <p className="hint">
              {t('p2p.willGet', {
                amount: formatMoney(amount - fee, currency),
                fee: formatMoney(fee, currency),
              })}
            </p>
          ) : null}
          <button
            type="button"
            className="button button--primary"
            disabled={!ok || send.isPending}
            onClick={() => {
              const to = recipient.data;
              if (!amount) return;
              send.mutate(
                { username: to.username, currency, amount },
                {
                  onSuccess: (res) => {
                    haptics.notify('success');
                    toast(
                      t('p2p.sent', {
                        amount: formatMoney(res.amount, currency),
                        name: to.firstName,
                      }),
                      'success',
                    );
                    setInput('');
                  },
                  onError: (e) => {
                    haptics.notify('error');
                    toast(errorText(t, e), 'error');
                  },
                },
              );
            }}
          >
            {t('p2p.send', { amount: amount ? formatMoney(amount, currency) : '' })}
          </button>
        </>
      )}
    </section>
  );
}
