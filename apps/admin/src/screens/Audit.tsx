import type { AdminAuditItem, Page } from '@spincards/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi } from '../api';
import { dateTime } from '../format';
import { Table } from '../ui';

export function Audit() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const audit = useInfiniteQuery({
    queryKey: ['audit', filter],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filter) params.set('action', filter);
      if (pageParam) params.set('cursor', pageParam);
      return adminApi<Page<AdminAuditItem>>(`/audit?${params.toString()}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = audit.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section>
      <h2>{t('nav.audit')}</h2>
      <input
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value.trim());
        }}
        placeholder={t('audit.filter')}
      />
      <Table
        head={[
          t('users.date'),
          t('audit.actor'),
          t('audit.action'),
          t('audit.target'),
          t('users.reasonCol'),
          '',
        ]}
        rows={items.map((a) => [
          dateTime(a.createdAt),
          a.actorName ?? `${a.actorType}${a.actorId ? `:${a.actorId.slice(0, 8)}` : ''}`,
          <code key="a">{a.action}</code>,
          a.targetType === 'user' && a.targetId ? (
            <a key="t" href={`#/users/${a.targetId}`}>
              user:{a.targetId.slice(0, 8)}
            </a>
          ) : (
            `${a.targetType ?? ''}${a.targetId ? `:${a.targetId.slice(0, 12)}` : ''}`
          ),
          a.reason ?? '',
          <code key="p" className="clip">
            {JSON.stringify(a.payload)}
          </code>,
        ])}
      />
      {audit.hasNextPage && (
        <button
          type="button"
          onClick={() => void audit.fetchNextPage()}
          disabled={audit.isFetchingNextPage}
        >
          {t('more')}
        </button>
      )}
    </section>
  );
}
