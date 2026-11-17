import type { AdminAlert, AdminStatRow } from '@spincards/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { adminApi, post } from '../api';
import { dateTime, money } from '../format';
import { Table } from '../ui';

const PERIODS = [7, 30, 90] as const;
const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6'];

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Rows of one metric by date, one column per dimension. */
function pivot(rows: AdminStatRow[], metric: string, scale = 1) {
  const byDate = new Map<string, Record<string, number | string>>();
  const dims = new Set<string>();
  for (const r of rows) {
    if (r.metric !== metric) continue;
    const key = r.dimension || metric;
    dims.add(key);
    const point = byDate.get(r.date) ?? { date: r.date.slice(5) };
    point[key] = Number(r.value) / scale;
    byDate.set(r.date, point);
  }
  return { data: [...byDate.values()], dims: [...dims].sort() };
}

function sum(rows: AdminStatRow[], metric: string, dimension?: string) {
  return rows
    .filter((r) => r.metric === metric && (dimension === undefined || r.dimension === dimension))
    .reduce((s, r) => s + Number(r.value), 0);
}

function Chart({
  title,
  rows,
  metric,
  scale,
  kind = 'line',
}: {
  title: string;
  rows: AdminStatRow[];
  metric: string | string[];
  scale?: number;
  kind?: 'line' | 'bar';
}) {
  const merged = useMemo(() => {
    const metrics = Array.isArray(metric) ? metric : [metric];
    const parts = metrics.map((m) =>
      pivot(
        rows.map((r) =>
          Array.isArray(metric) && r.metric === m
            ? { ...r, dimension: `${m}${r.dimension ? `:${r.dimension}` : ''}` }
            : r,
        ),
        m,
        scale,
      ),
    );
    const byDate = new Map<string, Record<string, number | string>>();
    for (const part of parts)
      for (const point of part.data)
        byDate.set(String(point.date), { ...byDate.get(String(point.date)), ...point });
    return {
      data: [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))),
      dims: parts.flatMap((p) => p.dims),
    };
  }, [rows, metric, scale]);
  if (merged.data.length === 0) return null;
  const Graph = kind === 'bar' ? BarChart : LineChart;
  return (
    <div className="chart card">
      <strong>{title}</strong>
      <ResponsiveContainer width="100%" height={220}>
        <Graph data={merged.data}>
          <CartesianGrid stroke="#2a2e38" />
          <XAxis dataKey="date" stroke="#8b8f99" fontSize={12} />
          <YAxis stroke="#8b8f99" fontSize={12} width={70} />
          <Tooltip contentStyle={{ background: '#1a1d24', border: '1px solid #2a2e38' }} />
          <Legend />
          {merged.dims.map((dim, i) =>
            kind === 'bar' ? (
              <Bar key={dim} dataKey={dim} stackId="a" fill={COLORS[i % COLORS.length]} />
            ) : (
              <Line key={dim} dataKey={dim} stroke={COLORS[i % COLORS.length]} dot={false} />
            ),
          )}
        </Graph>
      </ResponsiveContainer>
    </div>
  );
}

export function Dashboard() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(30);
  const from = day(-period + 1);
  const to = day(0);
  const stats = useQuery({
    queryKey: ['stats', from, to],
    queryFn: () => adminApi<AdminStatRow[]>(`/stats?from=${from}&to=${to}`),
  });
  const alerts = useQuery({
    queryKey: ['alerts'],
    queryFn: () => adminApi<AdminAlert[]>('/alerts'),
  });
  const rows = stats.data ?? [];
  const latest = rows.at(-1)?.date;
  const todayRows = rows.filter((r) => r.date === latest);

  const csv = () => {
    const text = [
      'date,metric,dimension,value',
      ...rows.map((r) => `${r.date},${r.metric},"${r.dimension}",${r.value}`),
    ].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    link.download = `spincards-stats-${from}-${to}.csv`;
    link.click();
  };

  const tiers = ['common', 'rare', 'epic', 'legendary', 'mythic'];
  const cohortDates = [
    // Days without sign-ups have no cohort to show.
    ...new Set(
      rows.filter((r) => r.metric === 'cohort_size' && r.value !== '0').map((r) => r.date),
    ),
  ].reverse();
  const cohortValue = (date: string, metric: string) =>
    rows.find((r) => r.date === date && r.metric === metric)?.value;
  const pct = (part?: string, whole?: string) =>
    part !== undefined && whole && Number(whole) > 0
      ? `${((Number(part) / Number(whole)) * 100).toFixed(1)}%`
      : '—';

  return (
    <section>
      <div className="row spread">
        <h2>{t('nav.dashboard')}</h2>
        <div className="row">
          <select
            value={period}
            onChange={(e) => {
              setPeriod(Number(e.target.value) as (typeof PERIODS)[number]);
            }}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {t('dashboard.days', { count: p })}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              void post('/stats/recompute').then(() =>
                client.invalidateQueries({ queryKey: ['stats'] }),
              );
            }}
          >
            {t('dashboard.recompute')}
          </button>
          <button type="button" onClick={csv} disabled={rows.length === 0}>
            {t('dashboard.csv')}
          </button>
        </div>
      </div>

      <Alerts alerts={alerts.data ?? []} />

      {rows.length === 0 ? (
        <p className="muted">{stats.isLoading ? t('loading') : t('dashboard.empty')}</p>
      ) : (
        <>
          <div className="kpis">
            {(['new_users', 'dau'] as const).map((m) => (
              <div key={m} className="kpi card">
                <span className="muted">{t(`dashboard.kpi.${m}`)}</span>
                <strong>{sum(todayRows, m)}</strong>
              </div>
            ))}
            <div className="kpi card">
              <span className="muted">{t('dashboard.kpi.spins')}</span>
              <strong>{sum(todayRows, 'spins')}</strong>
            </div>
            <div className="kpi card">
              <span className="muted">{t('dashboard.kpi.emission')}</span>
              <strong>{money(sum(todayRows, 'emission', 'RUB'), 'RUB')}</strong>
            </div>
            <div className="kpi card">
              <span className="muted">{t('dashboard.kpi.burn')}</span>
              <strong>{money(sum(todayRows, 'burn', 'RUB'), 'RUB')}</strong>
            </div>
          </div>

          <div className="charts">
            <Chart
              title={t('dashboard.audience')}
              rows={rows}
              metric={['dau', 'wau', 'mau', 'sessions']}
            />
            <Chart title={t('dashboard.newUsers')} rows={rows} metric="new_users" kind="bar" />
            <Chart title={t('dashboard.spinsByPack')} rows={rows} metric="spins" kind="bar" />
            <Chart
              title={`${t('dashboard.money')}, ₽`}
              rows={rows.filter((r) => r.dimension === 'RUB')}
              metric={['emission', 'burn']}
              scale={100}
            />
            <Chart title={t('dashboard.rtp')} rows={rows} metric="rtp_bp" scale={100} />
            <Chart title={t('dashboard.cards')} rows={rows} metric="cards" kind="bar" />
          </div>

          <h3>{t('dashboard.tiers')}</h3>
          <Table
            head={[t('dashboard.tier'), t('dashboard.actual'), t('dashboard.expected')]}
            rows={tiers.map((tier) => [
              tier,
              sum(rows, 'spins_by_tier', tier),
              (sum(rows, 'spins_by_tier_expected_milli', tier) / 1000).toFixed(1),
            ])}
          />

          <h3>{t('dashboard.cohorts')}</h3>
          <Table
            head={[t('dashboard.cohort'), t('dashboard.size'), 'D1', 'D7', 'D30']}
            rows={cohortDates.map((date) => {
              const size = cohortValue(date, 'cohort_size');
              return [
                date,
                size ?? '—',
                pct(cohortValue(date, 'retained_d1'), size),
                pct(cohortValue(date, 'retained_d7'), size),
                pct(cohortValue(date, 'retained_d30'), size),
              ];
            })}
          />

          <h3>{t('dashboard.funnel')}</h3>
          <Table
            head={[t('dashboard.funnel'), t('dashboard.count')]}
            rows={(['bot_start', 'spin_1', 'spin_5', 'day_2', 'day_7'] as const).map((step) => [
              t(`dashboard.funnelSteps.${step}`),
              sum(rows, 'funnel', step),
            ])}
          />

          <h3>{t('dashboard.economy')}</h3>
          <Table
            head={['', t('dashboard.avg'), t('dashboard.median'), t('dashboard.top1')]}
            rows={['RUB', 'USD'].map((cur) => [
              cur,
              money(sum(todayRows, 'balance_avg', cur), cur),
              money(sum(todayRows, 'balance_median', cur), cur),
              `${(sum(todayRows, 'balance_top1_share_bp', cur) / 100).toFixed(1)}%`,
            ])}
          />
        </>
      )}
    </section>
  );
}

const DISMISSED_KEY = 'spincards.admin.dismissedAlerts';

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** Safeguard alerts with what they mean and what to do; dismissed ones stay hidden (this browser). */
function Alerts({ alerts }: { alerts: AdminAlert[] }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(readDismissed);
  const visible = alerts.filter((a) => !dismissed.includes(a.id));
  if (visible.length === 0) return null;
  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-200);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Private mode: the alert just comes back after a reload.
    }
  };
  return (
    <div className="alerts-list">
      {visible.map((a) => {
        const p = a.payload as Record<string, string | number | boolean>;
        const params = {
          ...p,
          rtp: typeof p.rtpBp === 'number' ? (p.rtpBp / 100).toFixed(1) : '',
          paused: String(p.paused ?? false),
          emission:
            typeof p.emission === 'string' && typeof p.currency === 'string'
              ? money(Number(p.emission), p.currency)
              : '',
          limit:
            typeof p.limit === 'number' && typeof p.currency === 'string'
              ? money(p.limit, p.currency)
              : '',
        };
        const help = `dashboard.alertHelp.${a.action}`;
        return (
          <div key={a.id} className="card alerts">
            <div className="row spread">
              <strong>{t(`dashboard.alert.${a.action}`, params)}</strong>
              <span className="muted">{dateTime(a.createdAt)}</span>
            </div>
            <p>
              <b>{t('dashboard.alertWhat')}</b> {t(`${help}.what`, params)}
            </p>
            <p>
              <b>{t('dashboard.alertTodo')}</b> {t(`${help}.todo`, params)}
            </p>
            <div className="row">
              {a.action === 'safeguard.rtp' && p.paused === true && (
                <a href="#/flags">{t('dashboard.goFlags')}</a>
              )}
              <a href="#/configs">{t('dashboard.goConfigs')}</a>
              <button
                type="button"
                onClick={() => {
                  dismiss(a.id);
                }}
              >
                {t('dashboard.dismiss')}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
