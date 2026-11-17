import type { AdminBroadcastItem, BroadcastSegment } from '@spincards/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi, post } from '../api';
import { dateTime, useErrorText } from '../format';
import { Table } from '../ui';

export function Broadcasts() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const client = useQueryClient();
  const [text, setText] = useState('');
  const [segment, setSegment] = useState<BroadcastSegment>('all');
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const daysParam = segment === 'all' ? '' : `&days=${days}`;
  const preview = useQuery({
    queryKey: ['broadcast-preview', segment, days],
    queryFn: () =>
      adminApi<{ recipients: number }>(`/broadcasts/preview?segment=${segment}${daysParam}`),
  });
  const list = useQuery({
    queryKey: ['broadcasts'],
    queryFn: () => adminApi<AdminBroadcastItem[]>('/broadcasts'),
  });
  const recipients = preview.data?.recipients ?? 0;

  const send = () => {
    if (!window.confirm(t('broadcasts.confirmSend', { count: recipients }))) return;
    setBusy(true);
    setError(null);
    post('/broadcasts', { text, segment, ...(segment !== 'all' && { days: Number(days) }) })
      .then(() => {
        setText('');
        return client.invalidateQueries({ queryKey: ['broadcasts'] });
      })
      .catch((e: unknown) => {
        setError(errorText(e));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section>
      <h2>{t('nav.broadcasts')}</h2>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <strong>{t('broadcasts.new')}</strong>
        <label>
          {t('broadcasts.text')}
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
            rows={5}
            maxLength={4096}
            required
          />
        </label>
        <div className="row">
          <label>
            {t('broadcasts.segment')}
            <select
              value={segment}
              onChange={(e) => {
                setSegment(e.target.value as BroadcastSegment);
              }}
            >
              {(['all', 'active', 'inactive'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`broadcasts.segments.${s}`)}
                </option>
              ))}
            </select>
          </label>
          {segment !== 'all' && (
            <label>
              {t('broadcasts.days')}
              <input
                value={days}
                onChange={(e) => {
                  setDays(e.target.value.replace(/\D/g, ''));
                }}
                inputMode="numeric"
              />
            </label>
          )}
        </div>
        <span className="muted">{t('broadcasts.recipients', { count: recipients })}</span>
        {error && <span className="error">{error}</span>}
        <button
          type="submit"
          className="primary"
          disabled={busy || !text.trim() || recipients === 0}
        >
          {t('broadcasts.send')}
        </button>
      </form>
      <Table
        head={[
          t('broadcasts.created'),
          t('broadcasts.text'),
          t('broadcasts.segment'),
          t('broadcasts.sent'),
          t('broadcasts.pending'),
          t('broadcasts.failed'),
        ]}
        rows={(list.data ?? []).map((b) => [
          dateTime(b.createdAt),
          <span key="t" className="clip">
            {b.text}
          </span>,
          `${t(`broadcasts.segments.${b.segment}`)}${b.segmentDays ? ` (${String(b.segmentDays)})` : ''} · ${String(b.recipients)}`,
          b.sent,
          b.pending,
          b.failed,
        ])}
      />
    </section>
  );
}
