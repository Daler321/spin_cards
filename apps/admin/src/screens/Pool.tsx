import type { AdminPoolResponse } from '@spincards/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi } from '../api';
import { dateTime } from '../format';
import { Table } from '../ui';

export function Pool() {
  const { t } = useTranslation();
  const pool = useQuery({
    queryKey: ['pool'],
    queryFn: () => adminApi<AdminPoolResponse>('/pool'),
  });
  if (!pool.data) return <p className="muted">{t('loading')}</p>;
  return (
    <section>
      <h2>{t('nav.pool')}</h2>
      <p>{t('pool.total', { count: pool.data.total })}</p>
      <h3>{t('pool.byTier')}</h3>
      <Table
        head={[t('users.tier'), t('users.region'), t('pool.count')]}
        rows={pool.data.byTier.map((r) => [r.tier, r.region, r.count])}
      />
      <h3>{t('pool.oldest')}</h3>
      <Table
        head={[
          t('users.number'),
          t('users.tier'),
          t('users.region'),
          t('pool.owners'),
          t('pool.pooledAt'),
        ]}
        rows={pool.data.oldest.map((c) => [
          <code key="n">{c.number}</code>,
          c.tier,
          c.region,
          c.ownersCount,
          dateTime(c.pooledAt),
        ])}
      />
    </section>
  );
}
