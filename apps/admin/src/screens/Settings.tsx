import type {
  AdminChannelCheck,
  AdminOpsSettings,
  AdminOpsStatus,
  AdminOpsTestResult,
  AdminShareSettings,
  AdminSubscriptionSettings,
  OpsRunStatus,
} from '@spincards/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi, post } from '../api';
import { dateTime, useErrorText } from '../format';
import { ReasonAction } from '../ui';

const EMPTY = { chatId: '', title: '', url: '' };

/** Required channel subscription (D-110): channels and the switch; the bot token stays in .env. */
export function Settings() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const client = useQueryClient();
  const saved = useQuery({
    queryKey: ['settings', 'subscription'],
    queryFn: () => adminApi<AdminSubscriptionSettings>('/settings/subscription'),
  });
  const [edited, setDraft] = useState<AdminSubscriptionSettings | null>(null);
  const [checks, setChecks] = useState<AdminChannelCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draft = edited ?? saved.data;
  if (!draft) return <p className="muted">{t('loading')}</p>;

  const setChannel = (i: number, key: keyof typeof EMPTY, value: string) => {
    setDraft({
      ...draft,
      channels: draft.channels.map((c, j) => (j === i ? { ...c, [key]: value } : c)),
    });
    setChecks(null);
  };

  return (
    <section>
      <h2>{t('nav.settings')}</h2>
      <div className="card">
        <strong>{t('settings.subscription')}</strong>
        <p className="muted">{t('settings.subscriptionHint')}</p>
        <label className="row">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => {
              setDraft({ ...draft, enabled: e.target.checked });
            }}
          />
          {t('settings.enabled')}
        </label>
        {draft.channels.map((channel, i) => {
          const check = checks?.find((c) => c.chatId === channel.chatId);
          return (
            <div key={i} className="row">
              <label>
                {t('settings.chatId')}
                <input
                  value={channel.chatId}
                  placeholder="@channel"
                  onChange={(e) => {
                    setChannel(i, 'chatId', e.target.value.trim());
                  }}
                />
              </label>
              <label>
                {t('settings.title')}
                <input
                  value={channel.title}
                  onChange={(e) => {
                    setChannel(i, 'title', e.target.value);
                  }}
                />
              </label>
              <label className="grow">
                {t('settings.url')}
                <input
                  value={channel.url}
                  placeholder="https://t.me/channel"
                  onChange={(e) => {
                    setChannel(i, 'url', e.target.value.trim());
                  }}
                />
              </label>
              {check && (
                <span className={check.ok ? 'tag ok' : 'tag danger'}>
                  {check.ok
                    ? t('settings.botOk')
                    : `${t('settings.botFail')}: ${check.error ?? ''}`}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setDraft({ ...draft, channels: draft.channels.filter((_, j) => j !== i) });
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
        <div className="actions">
          <button
            type="button"
            disabled={draft.channels.length >= 5}
            onClick={() => {
              setDraft({ ...draft, channels: [...draft.channels, { ...EMPTY }] });
            }}
          >
            {t('settings.addChannel')}
          </button>
          <button
            type="button"
            disabled={draft.channels.length === 0}
            onClick={() => {
              setError(null);
              post<AdminChannelCheck[]>('/settings/subscription/check', draft)
                .then(setChecks)
                .catch((e: unknown) => {
                  setError(errorText(e));
                });
            }}
          >
            {t('settings.checkBot')}
          </button>
          <ReasonAction
            label={t('save')}
            onSubmit={(reason) =>
              post('/settings/subscription', { ...draft, reason }).then(() =>
                client.invalidateQueries({ queryKey: ['settings'] }),
              )
            }
          />
        </div>
        {error && <p className="error">{error}</p>}
        <p className="muted">{t('settings.botHint')}</p>
      </div>
      <ShareSettings />
      <OpsSettings />
    </section>
  );
}

/** The quiet channel line added under every shared card (D-114). */
function ShareSettings() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const saved = useQuery({
    queryKey: ['settings', 'share'],
    queryFn: () => adminApi<AdminShareSettings>('/settings/share'),
  });
  const [edited, setEdited] = useState<AdminShareSettings | null>(null);
  const value = edited ?? saved.data ?? { adText: '', adUrl: '' };
  return (
    <div className="card">
      <strong>{t('settings.share')}</strong>
      <p className="muted">{t('settings.shareHint')}</p>
      <label>
        {t('settings.adText')}
        <input
          value={value.adText}
          maxLength={200}
          placeholder="📢 Новости игры"
          onChange={(e) => {
            setEdited({ ...value, adText: e.target.value });
          }}
        />
      </label>
      <label>
        {t('settings.adUrl')}
        <input
          value={value.adUrl}
          placeholder="https://t.me/channel"
          onChange={(e) => {
            setEdited({ ...value, adUrl: e.target.value.trim() });
          }}
        />
      </label>
      <div className="actions">
        <ReasonAction
          label={t('save')}
          onSubmit={(reason) =>
            post('/settings/share', { ...value, reason }).then(() =>
              client.invalidateQueries({ queryKey: ['settings', 'share'] }),
            )
          }
        />
      </div>
    </div>
  );
}

/** Who gets operational alerts, and how the backups are doing (D-117). */
function OpsSettings() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const errorText = useErrorText();
  const saved = useQuery({
    queryKey: ['settings', 'ops'],
    queryFn: () => adminApi<AdminOpsSettings>('/settings/ops'),
  });
  const status = useQuery({
    queryKey: ['ops', 'status'],
    queryFn: () => adminApi<AdminOpsStatus>('/ops/status'),
  });
  const [edited, setEdited] = useState<string | null>(null);
  const [tests, setTests] = useState<AdminOpsTestResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const text = edited ?? saved.data?.alertChatIds.join(', ') ?? '';
  const alertChatIds = text
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  const s = status.data;
  const bytes = (n: number) =>
    n >= 1024 ** 3
      ? t('settings.ops.gb', { n: (n / 1024 ** 3).toFixed(1) })
      : t('settings.ops.mb', { n: (n / 1024 ** 2).toFixed(1) });

  const run = (label: string, value: OpsRunStatus | null | undefined, detail?: string) => (
    <p>
      <b>{label}:</b>{' '}
      {!value ? (
        <span className="muted">{t('settings.ops.never')}</span>
      ) : (
        <>
          <span className={value.ok ? 'tag ok' : 'tag danger'}>
            {value.ok ? t('settings.ops.ok') : t('settings.ops.failed')}
          </span>{' '}
          {dateTime(value.at)}
          {value.file && ` · ${value.file}`}
          {value.sizeBytes !== undefined && ` · ${bytes(value.sizeBytes)}`}
          {detail && ` · ${detail}`}
          {value.error && <span className="error"> {value.error}</span>}
        </>
      )}
    </p>
  );

  return (
    <div className="card">
      <strong>{t('settings.ops.title')}</strong>
      <p className="muted">{t('settings.ops.hint')}</p>
      <label>
        {t('settings.ops.chatIds')}
        <input
          value={text}
          placeholder="123456789"
          inputMode="numeric"
          onChange={(e) => {
            setEdited(e.target.value);
          }}
        />
      </label>
      <div className="actions">
        <ReasonAction
          label={t('save')}
          onSubmit={(reason) =>
            post('/settings/ops', { alertChatIds, reason }).then(() =>
              client.invalidateQueries({ queryKey: ['settings', 'ops'] }),
            )
          }
        />
        <button
          type="button"
          disabled={alertChatIds.length === 0}
          onClick={() => {
            setError(null);
            post<AdminOpsTestResult[]>('/settings/ops/test', { alertChatIds })
              .then(setTests)
              .catch((e: unknown) => {
                setError(errorText(e));
              });
          }}
        >
          {t('settings.ops.test')}
        </button>
      </div>
      {tests?.map((r) => (
        <p key={r.chatId} className={r.ok ? 'muted' : 'error'}>
          {r.ok
            ? t('settings.ops.testOk', { chatId: r.chatId })
            : t('settings.ops.testFail', { chatId: r.chatId, error: r.error ?? '' })}
        </p>
      ))}
      {error && <p className="error">{error}</p>}

      <strong>{t('settings.ops.backups')}</strong>
      {s && !s.backupsEnabled && <p className="muted">{t('settings.ops.backupsOff')}</p>}
      {s?.backupsEnabled && (
        <>
          {run(t('settings.ops.lastBackup'), s.backup)}
          {run(
            t('settings.ops.lastCheck'),
            s.restoreCheck,
            s.restoreCheck?.accounts !== undefined
              ? t('settings.ops.checkDetail', {
                  accounts: s.restoreCheck.accounts,
                  mismatches: s.restoreCheck.mismatches ?? 0,
                })
              : undefined,
          )}
          {s.disk && (
            <p className="muted">
              {t('settings.ops.disk', {
                free: bytes(s.disk.freeBytes),
                total: bytes(s.disk.totalBytes),
              })}
            </p>
          )}
          {s.files.length > 0 && (
            <details>
              <summary>
                {t('settings.ops.files')} ({s.files.length})
              </summary>
              <ul>
                {s.files.map((f) => (
                  <li key={f.name}>
                    {f.name} · {bytes(f.sizeBytes)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
