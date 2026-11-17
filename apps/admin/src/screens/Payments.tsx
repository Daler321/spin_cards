import type { AdminMe, AdminPaymentItem } from '@spincards/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi, post } from '../api';
import { dateTime } from '../format';
import { ReasonAction, Table } from '../ui';

const STATUSES = ['', 'pending', 'paid', 'refunded', 'failed'] as const;

export function Payments({ admin }: { admin: AdminMe }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [status, setStatus] = useState('');
  const payments = useQuery({
    queryKey: ['payments', status],
    queryFn: () => adminApi<AdminPaymentItem[]>(`/payments${status ? `?status=${status}` : ''}`),
  });
  return (
    <section>
      <h2>{t('nav.payments')}</h2>
      <select
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
        }}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s || t('payments.all')}
          </option>
        ))}
      </select>
      <Table
        head={[
          t('users.date'),
          t('payments.user'),
          t('payments.product'),
          t('payments.stars'),
          t('payments.status'),
          t('payments.paid'),
          '',
        ]}
        rows={(payments.data ?? []).map((p) => [
          dateTime(p.createdAt),
          <a key="u" href={`#/users/${p.userId}`}>
            {p.userId.slice(0, 8)}
          </a>,
          p.productId,
          p.starsAmount,
          p.status,
          dateTime(p.paidAt),
          admin.role === 'owner' && p.status === 'paid' ? (
            <ReasonAction
              key="r"
              label={t('payments.refund')}
              danger
              onSubmit={(reason) =>
                post(`/payments/${p.id}/refund`, { reason }).then(() =>
                  client.invalidateQueries({ queryKey: ['payments'] }),
                )
              }
            />
          ) : null,
        ])}
      />
    </section>
  );
}
