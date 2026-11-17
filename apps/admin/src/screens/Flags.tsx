import type { AdminFlag, AdminMe } from '@spincards/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, post } from '../api';
import { dateTime } from '../format';
import { ReasonAction, Table } from '../ui';

export function Flags({ admin }: { admin: AdminMe }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const flags = useQuery({ queryKey: ['flags'], queryFn: () => adminApi<AdminFlag[]>('/flags') });
  return (
    <section>
      <h2>{t('nav.flags')}</h2>
      <Table
        head={['', t('payments.status'), t('flags.updatedBy'), '']}
        rows={(flags.data ?? []).map((f) => [
          <span key="k">
            <code>{f.key}</code>
            <br />
            <span className="muted">{f.description}</span>
          </span>,
          <span key="s" className={`tag ${f.enabled ? 'ok' : ''}`}>
            {f.enabled ? t('flags.enabled') : t('flags.disabled')}
          </span>,
          `${f.updatedBy ?? '—'} · ${dateTime(f.updatedAt)}`,
          admin.role === 'owner' ? (
            <ReasonAction
              key="a"
              label={f.enabled ? t('flags.turnOff') : t('flags.turnOn')}
              danger={!f.enabled && f.key === 'maintenance_mode'}
              onSubmit={(reason) =>
                post(`/flags/${f.key}`, { enabled: !f.enabled, reason }).then(() =>
                  client.invalidateQueries({ queryKey: ['flags'] }),
                )
              }
            />
          ) : null,
        ])}
      />
    </section>
  );
}
