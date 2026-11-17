import type {
  AdminConfigDetail,
  AdminConfigVersion,
  AdminExperiment,
  AdminMe,
  ConfigDiffEntry,
  ConfigIssue,
  ConfigSimulationReport,
} from '@spincards/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi, post } from '../api';
import { dateTime, useErrorText } from '../format';
import { ReasonAction, Table } from '../ui';
import { ConfigForm } from './ConfigForm';
import { fromDisplay } from '../config-fields';

const TIERS = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const;

interface PackDraft {
  id: string;
  enabled: boolean;
  free: boolean;
  unlockLevel: number;
  prices: Record<string, number | undefined>;
  tierWeights: Record<string, number>;
}

export function Configs({ admin, onOpen }: { admin: AdminMe; onOpen: (id: number) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const versions = useQuery({
    queryKey: ['configs'],
    queryFn: () => adminApi<AdminConfigVersion[]>('/configs'),
  });
  const active = versions.data?.find((v) => v.status === 'active');
  const owner = admin.role === 'owner';

  return (
    <section>
      <h2>{t('nav.configs')}</h2>
      {owner && active && (
        <ReasonAction
          label={t('configs.newDraft')}
          onSubmit={async (comment) => {
            const source = await adminApi<AdminConfigDetail>(`/configs/${String(active.id)}`);
            const draft = await post<AdminConfigVersion>('/configs', {
              payload: source.payload,
              comment,
            });
            await client.invalidateQueries({ queryKey: ['configs'] });
            onOpen(draft.id);
          }}
        />
      )}
      <Table
        head={[
          '#',
          t('payments.status'),
          t('configs.sim'),
          t('configs.comment'),
          t('configs.by'),
          t('configs.created'),
          t('configs.activated'),
        ]}
        rows={(versions.data ?? []).map((v) => [
          <a key="id" href={`#/configs/${String(v.id)}`}>
            {v.id}
          </a>,
          <span key="s" className={`tag ${v.status === 'active' ? 'ok' : ''}`}>
            {t(`configs.status.${v.status}`)}
          </span>,
          v.simulationOk === null
            ? '—'
            : v.simulationOk
              ? t('configs.simOk')
              : t('configs.simFail'),
          v.comment ?? '',
          v.createdBy ?? '',
          dateTime(v.createdAt),
          dateTime(v.activatedAt),
        ])}
      />
      <Experiments owner={owner} versions={versions.data ?? []} />
    </section>
  );
}

function Experiments({ owner, versions }: { owner: boolean; versions: AdminConfigVersion[] }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const experiments = useQuery({
    queryKey: ['experiments'],
    queryFn: () => adminApi<AdminExperiment[]>('/experiments'),
  });
  const [group, setGroup] = useState('');
  const [versionId, setVersionId] = useState('');
  const usable = versions.filter((v) => v.status !== 'draft');
  const refresh = () => client.invalidateQueries({ queryKey: ['experiments'] });
  return (
    <>
      <h3>{t('configs.experiments')}</h3>
      <Table
        head={[t('configs.group'), t('configs.version'), t('configs.users'), '']}
        rows={(experiments.data ?? []).map((e) => [
          <code key="g">{e.group}</code>,
          e.versionId,
          e.users,
          owner ? (
            <ReasonAction
              key="u"
              label={t('configs.unbind')}
              onSubmit={(reason) =>
                post(`/experiments/${e.group}`, { versionId: null, reason }).then(refresh)
              }
            />
          ) : null,
        ])}
      />
      {owner && (
        <ReasonAction
          label={t('configs.bind')}
          onSubmit={(reason) =>
            post(`/experiments/${group}`, { versionId: Number(versionId), reason }).then(refresh)
          }
        >
          <div className="row">
            <label>
              {t('configs.newGroup')}
              <input
                value={group}
                onChange={(e) => {
                  setGroup(e.target.value.toLowerCase());
                }}
                placeholder="ab_test_1"
              />
            </label>
            <label>
              {t('configs.version')}
              <select
                value={versionId}
                onChange={(e) => {
                  setVersionId(e.target.value);
                }}
              >
                <option value="" />
                {usable.map((v) => (
                  <option key={v.id} value={v.id}>
                    #{v.id} · {t(`configs.status.${v.status}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </ReasonAction>
      )}
    </>
  );
}

export function ConfigDetail({
  id,
  admin,
  onBack,
}: {
  id: number;
  admin: AdminMe;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['config', id],
    queryFn: () => adminApi<AdminConfigDetail>(`/configs/${String(id)}`),
  });
  const diff = useQuery({
    queryKey: ['config-diff', id],
    queryFn: () => adminApi<ConfigDiffEntry[]>(`/configs/${String(id)}/diff`),
  });
  const [text, setText] = useState<string | null>(null);
  const [issues, setIssues] = useState<ConfigIssue[] | null>(null);
  const [spins, setSpins] = useState('50000');
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<'form' | 'packs' | 'json'>('form');
  const [error, setError] = useState<string | null>(null);

  if (!detail.data) return <p className="muted">{t('loading')}</p>;
  const v = detail.data;
  const owner = admin.role === 'owner';
  const editable = owner && (v.status === 'draft' || v.status === 'simulated');
  const json = text ?? JSON.stringify(v.payload, null, 2);
  let parsed: { packs?: PackDraft[] } | null = null;
  try {
    parsed = JSON.parse(json) as { packs?: PackDraft[] };
  } catch {
    parsed = null;
  }
  const refresh = async () => {
    setText(null);
    await Promise.all([
      client.invalidateQueries({ queryKey: ['config', id] }),
      client.invalidateQueries({ queryKey: ['config-diff', id] }),
      client.invalidateQueries({ queryKey: ['configs'] }),
    ]);
  };
  const setPack = (index: number, patch: (pack: PackDraft) => void) => {
    if (!parsed?.packs) return;
    const next = structuredClone(parsed);
    const pack = next.packs?.[index];
    if (!pack) return;
    patch(pack);
    setText(JSON.stringify(next, null, 2));
    setIssues(null);
  };

  return (
    <section>
      <button type="button" className="link" onClick={onBack}>
        {t('configs.back')}
      </button>
      <h2>
        #{v.id}{' '}
        <span className={`tag ${v.status === 'active' ? 'ok' : ''}`}>
          {t(`configs.status.${v.status}`)}
        </span>
      </h2>
      <p className="muted">
        {v.comment} · {v.createdBy} · {dateTime(v.createdAt)}
      </p>

      <div className="actions">
        {owner && v.status === 'simulated' && v.simulationOk && (
          <ReasonAction
            label={t('configs.activate')}
            onSubmit={(reason) => post(`/configs/${String(id)}/activate`, { reason }).then(refresh)}
          />
        )}
        {owner && v.status === 'archived' && (
          <ReasonAction
            label={t('configs.rollback')}
            danger
            onSubmit={(reason) => post(`/configs/${String(id)}/activate`, { reason }).then(refresh)}
          />
        )}
      </div>

      <h3>{t('configs.diff')}</h3>
      {(diff.data ?? []).length === 0 ? (
        <p className="muted">{t('configs.noDiff')}</p>
      ) : (
        <Table
          head={[t('configs.path'), t('configs.from'), t('configs.to')]}
          rows={(diff.data ?? []).map((d) => [
            <code key="p">{d.path}</code>,
            <code key="f" className="clip">
              {JSON.stringify(d.from)}
            </code>,
            <code key="t" className="clip">
              {JSON.stringify(d.to)}
            </code>,
          ])}
        />
      )}

      <h3>{t('configs.sim')}</h3>
      {editable && (
        <div className="row">
          <label>
            {t('configs.spinsPerPack')}
            <input
              value={spins}
              onChange={(e) => {
                setSpins(e.target.value.replace(/\D/g, ''));
              }}
              inputMode="numeric"
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={running || text !== null}
            onClick={() => {
              setRunning(true);
              setError(null);
              post<ConfigSimulationReport>(`/configs/${String(id)}/simulate`, {
                spins: Number(spins),
              })
                .then(refresh)
                .catch((e: unknown) => {
                  setError(errorText(e));
                })
                .finally(() => {
                  setRunning(false);
                });
            }}
          >
            {running ? t('configs.running') : t('configs.simulate')}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {v.simulation && (
        <>
          <p>
            <span className={`tag ${v.simulation.ok ? 'ok' : 'danger'}`}>
              {v.simulation.ok ? t('configs.simOk') : t('configs.simFail')}
            </span>{' '}
            <span className="muted">
              {t('configs.corridor', {
                min: v.simulation.corridor.minBp / 100,
                max: v.simulation.corridor.maxBp / 100,
              })}{' '}
              · {dateTime(v.simulation.ranAt)} · {v.simulation.spinsPerPack}
            </span>
          </p>
          <Table
            head={[
              t('configs.packs'),
              t('configs.region'),
              t('configs.scenario'),
              t('configs.rtp'),
              ...TIERS,
              t('configs.nearMiss'),
              t('configs.patterned'),
            ]}
            rows={v.simulation.items.map((i) => [
              i.packId,
              i.region,
              t(`configs.scenarios.${i.scenario}`),
              <span key="r" className={i.inCorridor ? '' : 'error'}>
                {i.rtpBp === null ? '—' : `${(i.rtpBp / 100).toFixed(1)}%`}
              </span>,
              ...TIERS.map((tier) => {
                const x = i.tiers[tier];
                return x
                  ? `${(x.actualBp / 100).toFixed(2)} / ${(x.configuredBp / 100).toFixed(2)}`
                  : '—';
              }),
              `${(i.nearMissShareBp / 100).toFixed(1)}%`,
              `${(i.patternedShareBp / 100).toFixed(1)}%`,
            ])}
          />
          {v.simulation.minigames && v.simulation.minigames.length > 0 && (
            <Table
              head={[t('configs.minigame'), t('configs.difficulty'), t('configs.rtp')]}
              rows={v.simulation.minigames.map((m) => [
                t(`configs.minigames.${m.game}`),
                m.difficulty ?? '—',
                <span key="r" className={m.inCorridor ? '' : 'error'}>
                  {m.minBp === m.maxBp
                    ? `${(m.minBp / 100).toFixed(1)}%`
                    : `${(m.minBp / 100).toFixed(1)}–${(m.maxBp / 100).toFixed(1)}%`}
                </span>,
              ])}
            />
          )}
        </>
      )}

      <h3>{t('configs.editor')}</h3>
      <p className="guide">{t('cfg.guide')}</p>
      <div className="tabs">
        {(['form', 'packs', 'json'] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'active' : ''}
            onClick={() => {
              setTab(id);
            }}
          >
            {t(`cfg.tabs.${id}`)}
          </button>
        ))}
      </div>
      {tab === 'form' && parsed && (
        <ConfigForm
          value={parsed}
          editable={editable}
          onChange={(next) => {
            setText(JSON.stringify(next, null, 2));
            setIssues(null);
          }}
        />
      )}
      {tab === 'packs' && parsed?.packs && (
        <>
          <strong>{t('configs.packs')}</strong>
          <Table
            head={[
              t('configs.packId'),
              t('configs.enabled'),
              t('configs.unlock'),
              `${t('configs.prices')} ₽ / $`,
              ...TIERS.map((tier) => `${tier}, %`),
            ]}
            rows={parsed.packs.map((pack, index) => [
              pack.id,
              <input
                key="e"
                type="checkbox"
                checked={pack.enabled}
                disabled={!editable}
                onChange={(e) => {
                  setPack(index, (p) => (p.enabled = e.target.checked));
                }}
              />,
              <input
                key="u"
                className="num"
                value={pack.unlockLevel}
                disabled={!editable}
                onChange={(e) => {
                  setPack(index, (p) => (p.unlockLevel = Number(e.target.value) || 1));
                }}
              />,
              pack.free ? (
                '—'
              ) : (
                <span key="p" className="row">
                  {(['RUB', 'USD'] as const).map((cur) => (
                    <input
                      key={cur}
                      className="num"
                      value={pack.prices[cur] === undefined ? '' : String(pack.prices[cur] / 100)}
                      disabled={!editable}
                      onChange={(e) => {
                        const minor = fromDisplay('money', e.target.value);
                        if (minor !== null) setPack(index, (p) => (p.prices[cur] = minor));
                      }}
                    />
                  ))}
                </span>
              ),
              ...TIERS.map((tier) => {
                const total = TIERS.reduce((sum, x) => sum + (pack.tierWeights[x] ?? 0), 0);
                const share = total > 0 ? ((pack.tierWeights[tier] ?? 0) / total) * 100 : 0;
                return (
                  <span key={tier} className="weight">
                    <input
                      className="num"
                      value={pack.tierWeights[tier] ?? 0}
                      disabled={!editable}
                      onChange={(e) => {
                        setPack(index, (p) => (p.tierWeights[tier] = Number(e.target.value) || 0));
                      }}
                    />
                    <span className="muted">{share.toFixed(share < 1 ? 2 : 1)}%</span>
                  </span>
                );
              }),
            ])}
          />
          <span className="muted">{t('configs.weightsHint')}</span>
        </>
      )}
      {tab === 'json' && (
        <label>
          {t('configs.json')}
          <textarea
            className="code"
            value={json}
            readOnly={!editable}
            rows={24}
            onChange={(e) => {
              setText(e.target.value);
              setIssues(null);
            }}
          />
        </label>
      )}
      {parsed === null && <p className="error">{t('configs.invalidJson')}</p>}
      {issues && (
        <p className={issues.length === 0 ? 'ok-text' : 'error'}>
          {issues.length === 0
            ? t('configs.valid')
            : issues.map((i) => `${i.path}: ${i.message}`).join('; ')}
        </p>
      )}
      {editable && (
        <div className="actions">
          <button
            type="button"
            disabled={parsed === null}
            onClick={() => {
              void post<{ issues: ConfigIssue[] }>('/configs/validate', { payload: parsed }).then(
                (r) => {
                  setIssues(r.issues);
                },
              );
            }}
          >
            {t('configs.validate')}
          </button>
          <ReasonAction
            label={t('configs.saveDraft')}
            disabled={parsed === null || text === null}
            onSubmit={(comment) =>
              post(`/configs/${String(id)}`, { payload: parsed, comment }).then(refresh)
            }
          />
        </div>
      )}
    </section>
  );
}
