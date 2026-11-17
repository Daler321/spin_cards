import {
  CURRENCIES,
  type AdminFraudEntry,
  type AdminMe,
  type AdminUserDetail,
  type AdminUserListItem,
} from '@spincards/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi, newKey, post } from '../api';
import { dateTime, money } from '../format';
import { ReasonAction, Table } from '../ui';

export function Users() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const users = useQuery({
    queryKey: ['users', query],
    queryFn: () => adminApi<AdminUserListItem[]>(`/users?q=${encodeURIComponent(query)}`),
  });
  return (
    <section>
      <h2>{t('nav.users')}</h2>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <input
          className="grow"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
          }}
          placeholder={t('users.search')}
        />
        <button type="submit" className="primary">
          {t('more')}
        </button>
      </form>
      <Table
        head={[
          t('users.name'),
          t('users.telegram'),
          t('users.level'),
          t('users.region'),
          t('users.created'),
          t('users.seen'),
        ]}
        rows={(users.data ?? []).map((u) => [
          <a key="n" href={`#/users/${u.id}`}>
            {u.firstName} {u.username ? `@${u.username}` : ''}{' '}
            {u.isBanned && <span className="tag danger">{t('users.banned')}</span>}
          </a>,
          u.telegramId,
          u.level,
          u.region,
          dateTime(u.createdAt),
          dateTime(u.lastSeenAt),
        ])}
      />
      <Suspicious />
    </section>
  );
}

/** Players with antifraud signals (D-119): a list to look at, nothing is blocked automatically. */
function Suspicious() {
  const { t } = useTranslation();
  const list = useQuery({
    queryKey: ['fraud'],
    queryFn: () => adminApi<AdminFraudEntry[]>('/fraud'),
  });
  return (
    <>
      <h3>{t('fraud.title')}</h3>
      <p className="muted">{t('fraud.hint')}</p>
      {list.data?.length === 0 ? (
        <p className="muted">{t('fraud.empty')}</p>
      ) : (
        <Table
          head={[t('users.name'), t('users.level'), t('fraud.signals')]}
          rows={(list.data ?? []).map((u) => [
            <a key="n" href={`#/users/${u.userId}`}>
              {u.firstName} {u.username ? `@${u.username}` : ''}{' '}
              {u.isBanned && <span className="tag danger">{t('users.banned')}</span>}
            </a>,
            u.level,
            u.signals.map((s) => t(`fraud.kind.${s.kind}`, { value: s.value })).join(' · '),
          ])}
        />
      )}
    </>
  );
}

export function UserDetail({
  id,
  admin,
  onBack,
}: {
  id: string;
  admin: AdminMe;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const user = useQuery({
    queryKey: ['user', id],
    queryFn: () => adminApi<AdminUserDetail>(`/users/${id}`),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['user', id] });
  const [currency, setCurrency] = useState<string>('RUB');
  const [amount, setAmount] = useState('');
  const [boost, setBoost] = useState('10');
  const [spins, setSpins] = useState('3');
  const [group, setGroup] = useState('');

  if (!user.data) return <p className="muted">{t('loading')}</p>;
  const u = user.data;
  const minor = Math.round(Number(amount.replace(',', '.')) * 100);

  return (
    <section>
      <button type="button" className="link" onClick={onBack}>
        {t('users.back')}
      </button>
      <h2>
        {u.firstName} {u.username && <span className="muted">@{u.username}</span>}{' '}
        {u.isBanned && <span className="tag danger">{t('users.banned')}</span>}
      </h2>
      <dl className="facts">
        <dt>Id</dt>
        <dd>{u.id}</dd>
        <dt>{t('users.telegram')}</dt>
        <dd>{u.telegramId}</dd>
        <dt>{t('users.level')}</dt>
        <dd>
          {u.level} · {t('users.exp')} {u.exp}
        </dd>
        <dt>{t('users.totalSpins')}</dt>
        <dd>{u.totalSpins}</dd>
        <dt>{t('users.region')}</dt>
        <dd>{u.region}</dd>
        <dt>{t('users.refCode')}</dt>
        <dd>{u.referralCode}</dd>
        <dt>{t('users.notifications')}</dt>
        <dd>{u.notificationsEnabled ? t('yes') : t('no')}</dd>
        <dt>{t('users.hidden')}</dt>
        <dd>{u.hideFromLeaderboard ? t('yes') : t('no')}</dd>
        <dt>{t('users.botBlocked')}</dt>
        <dd>{u.botBlockedAt ? dateTime(u.botBlockedAt) : t('no')}</dd>
        <dt>{t('users.experiment')}</dt>
        <dd>{u.experimentGroup ?? '—'}</dd>
        <dt>{t('users.created')}</dt>
        <dd>{dateTime(u.createdAt)}</dd>
        <dt>{t('users.seen')}</dt>
        <dd>{dateTime(u.lastSeenAt)}</dd>
      </dl>

      <div className="actions">
        <ReasonAction
          label={u.isBanned ? t('users.unban') : t('users.ban')}
          danger={!u.isBanned}
          onSubmit={(reason) =>
            post(`/users/${id}/ban`, { banned: !u.isBanned, reason }).then(refresh)
          }
        />
        {admin.role === 'owner' && (
          <ReasonAction
            label={t('users.adjust')}
            disabled={false}
            onSubmit={(reason) =>
              post(`/users/${id}/adjust`, {
                currency,
                amount: minor,
                reason,
                idempotencyKey: newKey(),
              }).then(() => {
                setAmount('');
                return refresh();
              })
            }
          >
            <div className="row">
              <label>
                {t('users.currency')}
                <select
                  value={currency}
                  onChange={(e) => {
                    setCurrency(e.target.value);
                  }}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="grow">
                {t('users.amount')}
                <input
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                  }}
                  inputMode="decimal"
                  required
                />
              </label>
            </div>
          </ReasonAction>
        )}
        {admin.role === 'owner' && (
          <ReasonAction
            label={t('users.setExperiment')}
            onSubmit={(reason) =>
              post(`/users/${id}/experiment`, { group: group.trim() || null, reason }).then(refresh)
            }
          >
            <label>
              {t('users.experiment')}
              <input
                value={group}
                onChange={(e) => {
                  setGroup(e.target.value.toLowerCase());
                }}
                placeholder={t('users.groupHint')}
              />
            </label>
          </ReasonAction>
        )}
        <ReasonAction
          label={t('users.buff')}
          onSubmit={(reason) =>
            post(`/users/${id}/buff`, {
              points: Math.round(Number(boost)),
              spins: Number(spins),
              reason,
            }).then(refresh)
          }
        >
          <div className="row">
            <label>
              {t('users.boost')}
              <input
                value={boost}
                onChange={(e) => {
                  setBoost(e.target.value);
                }}
                inputMode="decimal"
              />
            </label>
            <label>
              {t('users.spinsCount')}
              <input
                value={spins}
                onChange={(e) => {
                  setSpins(e.target.value);
                }}
                inputMode="numeric"
              />
            </label>
          </div>
        </ReasonAction>
      </div>

      <h3>{t('users.wallets')}</h3>
      <Table
        head={[t('users.currency'), t('users.balance')]}
        rows={u.wallets.map((w) => [w.currency, money(w.balance, w.currency)])}
      />
      <h3>{t('users.cards')}</h3>
      <Table
        head={[
          t('users.number'),
          t('users.tier'),
          t('users.status'),
          t('users.balance'),
          t('users.held'),
          t('users.expires'),
          '',
        ]}
        rows={u.cards.map((c) => [
          <code key="n">{c.number}</code>,
          c.tier,
          c.status,
          money(c.balance, c.currency),
          c.held ? t('yes') : t('no'),
          dateTime(c.expiresAt),
          admin.role === 'owner' && (c.status === 'active' || c.status === 'expired') ? (
            <CardAdjust key="a" userId={id} cardId={c.id} onDone={refresh} />
          ) : null,
        ])}
      />
      <h3>{t('users.buffs')}</h3>
      <Table
        head={[t('users.boost'), t('users.spinsCount'), t('users.pack1'), t('users.source')]}
        rows={u.buffs.map((b) => [
          b.points !== null
            ? `+${String(b.points)}`
            : `×${String((b.multiplierBp ?? 10_000) / 10_000)}`,
          b.spinsLeft ?? (b.expiresAt ? dateTime(b.expiresAt) : '—'),
          b.packId ?? '—',
          b.source,
        ])}
      />
      <h3>{t('users.ledger')}</h3>
      <Table
        head={[
          t('users.date'),
          t('users.account'),
          t('users.reasonCol'),
          t('users.delta'),
          t('users.after'),
        ]}
        rows={u.ledger.map((e) => [
          dateTime(e.createdAt),
          `${e.accountType}:${e.accountId.slice(0, 8)}`,
          e.reason,
          money(e.delta, e.currency),
          money(e.balanceAfter, e.currency),
        ])}
      />
      <h3>{t('users.spins')}</h3>
      <Table
        head={[t('users.date'), t('users.pack1'), t('users.price')]}
        rows={u.spins.map((s) => [dateTime(s.createdAt), s.packId, money(s.price, s.currency)])}
      />
      <h3>{t('users.referrals')}</h3>
      <Table
        head={[t('users.name'), t('users.status'), t('users.created')]}
        rows={u.referrals.map((r) => [
          <a key="r" href={`#/users/${r.id}`}>
            {r.firstName}
          </a>,
          r.status,
          dateTime(r.createdAt),
        ])}
      />
    </section>
  );
}

/** Credit (+) or debit (−) a card through the ledger, with a reason. */
function CardAdjust({
  userId,
  cardId,
  onDone,
}: {
  userId: string;
  cardId: string;
  onDone: () => unknown;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const minor = Math.round(Number(amount.replace(',', '.')) * 100);
  return (
    <ReasonAction
      label={t('users.adjustCard')}
      onSubmit={(reason) =>
        post(`/users/${userId}/cards/${cardId}/adjust`, {
          amount: minor,
          reason,
          idempotencyKey: newKey(),
        }).then(() => {
          setAmount('');
          return onDone();
        })
      }
    >
      <label>
        {t('users.amount')}
        <input
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
          }}
          inputMode="decimal"
          required
        />
      </label>
    </ReasonAction>
  );
}
