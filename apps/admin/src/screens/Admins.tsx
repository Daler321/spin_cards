import type { AdminAccount, AdminMe, AdminRole } from '@spincards/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi, post } from '../api';
import { dateTime } from '../format';
import { ReasonAction, Table } from '../ui';

const ROLES: AdminRole[] = ['owner', 'analyst', 'support'];

/** Admin accounts (owner only, D-120): create, change role, disable, reset TOTP or password. */
export function Admins({ admin }: { admin: AdminMe }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ['admins'],
    queryFn: () => adminApi<AdminAccount[]>('/admins'),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['admins'] });
  const [login, setLogin] = useState('');
  const [role, setRole] = useState<AdminRole>('support');
  const [password, setPassword] = useState('');
  const change = (id: string, body: object) => (reason: string) =>
    post(`/admins/${id}`, { ...body, reason }).then(refresh);

  return (
    <section>
      <h2>{t('nav.admins')}</h2>
      <p className="muted">{t('admins.hint')}</p>
      <Table
        head={[t('admins.login'), t('admins.role'), t('admins.status'), t('admins.lastLogin'), '']}
        rows={(list.data ?? []).map((a) => [
          <span key="l">
            {a.login} {a.id === admin.id && <span className="muted">({t('admins.you')})</span>}
          </span>,
          t(`roles.${a.role}`),
          <span key="s">
            <span className={`tag ${a.isActive ? 'ok' : 'danger'}`}>
              {a.isActive ? t('admins.active') : t('admins.disabled')}
            </span>{' '}
            {!a.totpEnabled && <span className="tag">{t('admins.noTotp')}</span>}
          </span>,
          dateTime(a.lastLoginAt),
          <div key="a" className="row">
            <select
              value={a.role}
              disabled={a.id === admin.id}
              aria-label={t('admins.role')}
              onChange={(e) => {
                void post(`/admins/${a.id}`, {
                  role: e.target.value,
                  reason: t('admins.roleChanged'),
                }).then(refresh);
              }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
            {a.id !== admin.id && (
              <ReasonAction
                label={a.isActive ? t('admins.disable') : t('admins.enable')}
                danger={a.isActive}
                onSubmit={change(a.id, { isActive: !a.isActive })}
              />
            )}
            {a.totpEnabled && (
              <ReasonAction
                label={t('admins.resetTotp')}
                onSubmit={change(a.id, { resetTotp: true })}
              />
            )}
          </div>,
        ])}
      />

      <div className="card">
        <strong>{t('admins.create')}</strong>
        <div className="row">
          <label>
            {t('admins.login')}
            <input
              value={login}
              placeholder="anna"
              autoComplete="off"
              onChange={(e) => {
                setLogin(e.target.value.trim().toLowerCase());
              }}
            />
          </label>
          <label>
            {t('admins.role')}
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value as AdminRole);
              }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('admins.password')}
            <input
              type="text"
              value={password}
              autoComplete="new-password"
              onChange={(e) => {
                setPassword(e.target.value);
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const bytes = crypto.getRandomValues(new Uint8Array(12));
              setPassword(btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, ''));
            }}
          >
            {t('admins.generate')}
          </button>
        </div>
        <p className="muted">{t('admins.createHint')}</p>
        <div className="actions">
          <ReasonAction
            label={t('admins.create')}
            disabled={!/^[a-z0-9_.-]{3,32}$/.test(login) || password.length < 12}
            onSubmit={(reason) =>
              post('/admins', { login, role, password, reason }).then(() => {
                setLogin('');
                setPassword('');
                return refresh();
              })
            }
          />
        </div>
      </div>
    </section>
  );
}
