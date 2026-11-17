import type { AdminSeasonItem } from '@spincards/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi, post } from '../api';
import { dateTime } from '../format';
import { ReasonAction, Table } from '../ui';

export function Seasons({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const seasons = useQuery({
    queryKey: ['seasons'],
    queryFn: () => adminApi<AdminSeasonItem[]>('/seasons'),
  });
  const active = seasons.data?.find((s) => s.status === 'active');
  const [endsAt, setEndsAt] = useState('');
  return (
    <section>
      <h2>{t('nav.seasons')}</h2>
      <p className="muted">{t('seasons.hint')}</p>
      <Table
        head={[t('seasons.name'), t('seasons.status'), t('seasons.starts'), t('seasons.ends')]}
        rows={(seasons.data ?? []).map((s) => [
          s.name,
          t(`seasons.statuses.${s.status}`, { defaultValue: s.status }),
          dateTime(s.startsAt),
          dateTime(s.endsAt),
        ])}
      />
      {canEdit && active && (
        <div className="card">
          <strong>{t('seasons.changeEnd', { name: active.name })}</strong>
          <label>
            {t('seasons.ends')}
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => {
                setEndsAt(e.target.value);
              }}
            />
          </label>
          <div className="actions">
            <ReasonAction
              label={t('save')}
              disabled={!endsAt}
              onSubmit={(reason) =>
                post('/seasons/current', { endsAt: new Date(endsAt).toISOString(), reason }).then(
                  () => client.invalidateQueries({ queryKey: ['seasons'] }),
                )
              }
            />
          </div>
        </div>
      )}
    </section>
  );
}
