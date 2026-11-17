import { Injectable } from '@nestjs/common';
import { GameConfigService } from '../game-config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  addDays,
  emissionAndBurn,
  localDate,
  median,
  type MetricRow,
  topShareBp,
} from './metrics.js';

/** Retention days of a signup cohort (TZ 15.1). */
export const RETENTION_DAYS = [1, 7, 30] as const;
/** Cohorts this young still change, so they are recomputed. */
const COHORT_WINDOW_DAYS = 31;

interface Bounds {
  start: Date;
  end: Date;
}

type Row = { dimension: string | null; value: bigint | number | null };

/**
 * Daily aggregates in `daily_stats` (TZ 15.1): one row per (date, metric, dimension). A day is a
 * calendar day in the analytics timezone. Recomputing a day replaces its rows, so the hourly job
 * can run any number of times. Sources: events (sign-ups, app opens, spin outcomes, kept cards,
 * bot), spins, ledger entries, conversions, referrals, payments and the notifications outbox.
 * A player is active on a day if they opened the app or spun (D-097).
 */
@Injectable()
export class DailyStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
  ) {}

  /** Today and yesterday (late events), plus retention of the recent cohorts. */
  async runRecent(now = new Date()): Promise<{ days: string[] }> {
    const { config } = await this.config.active();
    const today = localDate(now, config.analytics.timezone);
    // D-152: days before the statistics start are not kept.
    if (config.analytics.since)
      await this.prisma.dailyStat.deleteMany({
        where: {
          date: {
            lt: new Date(
              `${localDate(new Date(config.analytics.since), config.analytics.timezone)}T00:00:00Z`,
            ),
          },
        },
      });
    const days = [addDays(today, -1), today];
    for (const day of days) await this.computeDay(day, { snapshot: day === today });
    for (let i = 0; i <= COHORT_WINDOW_DAYS; i++)
      await this.computeCohort(addDays(today, -i), today);
    return { days };
  }

  /**
   * Metrics of one day. `snapshot` adds the point-in-time ones (balances, pool size), which only
   * make sense for the current day.
   */
  async computeDay(date: string, options: { snapshot?: boolean } = {}): Promise<MetricRow[]> {
    const { config } = await this.config.active();
    const tz = config.analytics.timezone;
    const day = await this.bounds(date, tz);
    // D-152: a day wholly before the statistics start keeps no rows.
    if (day.start >= day.end) {
      await this.prisma.dailyStat.deleteMany({ where: { date: new Date(`${date}T00:00:00Z`) } });
      return [];
    }
    const rows: MetricRow[] = [
      ...(await this.audience(date, day, tz, config.analytics.sessionGapMinutes)),
      ...(await this.game(day)),
      ...(await this.economy(day)),
      ...(await this.growth(day)),
      ...(options.snapshot ? await this.snapshot() : []),
    ];
    await this.replace(date, rows, options.snapshot ? [] : SNAPSHOT_METRICS);
    return rows;
  }

  /** Cohort of players who signed up on `date`: size and how many were active N days later. */
  async computeCohort(date: string, today: string): Promise<MetricRow[]> {
    const { config } = await this.config.active();
    const tz = config.analytics.timezone;
    const day = await this.bounds(date, tz);
    if (day.start >= day.end) return [];
    const rows: MetricRow[] = [];
    const size = await this.prisma.$queryRaw<{ value: bigint }[]>`
      SELECT count(*)::bigint AS value FROM users
      WHERE created_at >= ${day.start} AND created_at < ${day.end}`;
    rows.push({ metric: 'cohort_size', dimension: '', value: size[0]?.value ?? 0n });
    for (const n of RETENTION_DAYS) {
      const target = addDays(date, n);
      if (target > today) continue;
      const span = await this.bounds(target, tz);
      const retained = await this.prisma.$queryRaw<{ value: bigint }[]>`
        SELECT count(DISTINCT u.id)::bigint AS value FROM users u
        WHERE u.created_at >= ${day.start} AND u.created_at < ${day.end}
          AND (EXISTS (SELECT 1 FROM events e WHERE e.user_id = u.id AND e.name = 'app_open'
                AND e.created_at >= ${span.start} AND e.created_at < ${span.end})
            OR EXISTS (SELECT 1 FROM spins s WHERE s.user_id = u.id
                AND s.created_at >= ${span.start} AND s.created_at < ${span.end}))`;
      rows.push({
        metric: `retained_d${String(n)}`,
        dimension: '',
        value: retained[0]?.value ?? 0n,
      });
    }
    // Funnel of the cohort (TZ 15.1): bot start -> 1st spin -> 5th spin -> day 2 -> day 7.
    const funnel = await this.prisma.$queryRaw<{ started: bigint; first: bigint; fifth: bigint }[]>`
      SELECT
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM events e
          WHERE e.user_id = u.id AND e.name = 'bot_start'))::bigint AS started,
        count(*) FILTER (WHERE u.total_spins >= 1)::bigint AS first,
        count(*) FILTER (WHERE u.total_spins >= 5)::bigint AS fifth
      FROM users u WHERE u.created_at >= ${day.start} AND u.created_at < ${day.end}`;
    const f = funnel[0];
    rows.push(
      { metric: 'funnel', dimension: 'bot_start', value: f?.started ?? 0n },
      { metric: 'funnel', dimension: 'spin_1', value: f?.first ?? 0n },
      { metric: 'funnel', dimension: 'spin_5', value: f?.fifth ?? 0n },
    );
    for (const [dimension, n] of [
      ['day_2', 1],
      ['day_7', 6],
    ] as const) {
      const target = addDays(date, n);
      if (target > today) continue;
      const span = await this.bounds(target, tz);
      const active = await this.prisma.$queryRaw<{ value: bigint }[]>`
        SELECT count(DISTINCT u.id)::bigint AS value FROM users u
        WHERE u.created_at >= ${day.start} AND u.created_at < ${day.end}
          AND (EXISTS (SELECT 1 FROM events e WHERE e.user_id = u.id AND e.name = 'app_open'
                AND e.created_at >= ${span.start} AND e.created_at < ${span.end})
            OR EXISTS (SELECT 1 FROM spins s WHERE s.user_id = u.id
                AND s.created_at >= ${span.start} AND s.created_at < ${span.end}))`;
      rows.push({ metric: 'funnel', dimension, value: active[0]?.value ?? 0n });
    }
    await this.replace(date, rows, [], COHORT_METRICS);
    return rows;
  }

  private async audience(date: string, day: Bounds, tz: string, gapMinutes: number) {
    const rows: MetricRow[] = [];
    rows.push(
      await this.one(
        'new_users',
        this.prisma.$queryRaw<Row[]>`
        SELECT NULL AS dimension, count(*)::bigint AS value FROM users
        WHERE created_at >= ${day.start} AND created_at < ${day.end}`,
      ),
    );
    for (const [metric, days] of [
      ['dau', 1],
      ['wau', 7],
      ['mau', 30],
    ] as const) {
      const from = await this.bounds(addDays(date, 1 - days), tz);
      rows.push(
        await this.one(
          metric,
          this.prisma.$queryRaw<Row[]>`
          SELECT NULL AS dimension, count(DISTINCT user_id)::bigint AS value FROM (
            SELECT user_id FROM events WHERE name = 'app_open'
              AND created_at >= ${from.start} AND created_at < ${day.end}
            UNION ALL
            SELECT user_id FROM spins WHERE created_at >= ${from.start} AND created_at < ${day.end}
          ) active`,
        ),
      );
    }
    // A session starts with an app open more than `gap` after the player's previous one.
    rows.push(
      await this.one(
        'sessions',
        this.prisma.$queryRaw<Row[]>`
        SELECT NULL AS dimension, count(*)::bigint AS value FROM (
          SELECT created_at, lag(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS prev
          FROM events WHERE name = 'app_open'
            AND created_at >= ${new Date(day.start.getTime() - gapMinutes * 60_000)}
            AND created_at < ${day.end}
        ) opens
        WHERE created_at >= ${day.start}
          AND (prev IS NULL OR created_at - prev > ${gapMinutes} * interval '1 minute')`,
      ),
    );
    return rows;
  }

  private async game(day: Bounds) {
    const q = this.prisma;
    return [
      ...(await this.many(
        'spins',
        q.$queryRaw<Row[]>`
        SELECT pack_id AS dimension, count(*)::bigint AS value FROM spins
        WHERE created_at >= ${day.start} AND created_at < ${day.end} GROUP BY pack_id`,
      )),
      ...(await this.many(
        'spins_by_payment',
        q.$queryRaw<Row[]>`
        SELECT payment_source::text AS dimension, count(*)::bigint AS value FROM spins
        WHERE created_at >= ${day.start} AND created_at < ${day.end} GROUP BY payment_source`,
      )),
      ...(await this.many(
        'spins_by_tier',
        q.$queryRaw<Row[]>`
        SELECT props->>'tier' AS dimension, count(*)::bigint AS value FROM events
        WHERE name = 'spin' AND created_at >= ${day.start} AND created_at < ${day.end}
        GROUP BY props->>'tier'`,
      )),
      // Expected tier counts from the weights each spin was rolled with (×1000).
      ...(await this.many(
        'spins_by_tier_expected_milli',
        q.$queryRaw<Row[]>`
        SELECT w.key AS dimension,
          round(sum(1000 * w.value::numeric / NULLIF(t.total, 0)))::bigint AS value
        FROM spins s
        CROSS JOIN LATERAL jsonb_each_text(s.rolled_params->'tierWeights') w
        CROSS JOIN LATERAL (SELECT sum(v.value::numeric) AS total
          FROM jsonb_each_text(s.rolled_params->'tierWeights') v) t
        WHERE s.created_at >= ${day.start} AND s.created_at < ${day.end}
        GROUP BY w.key`,
      )),
      ...(await this.many(
        'patterns',
        q.$queryRaw<Row[]>`
        SELECT p.value AS dimension, count(*)::bigint AS value FROM events e
        CROSS JOIN LATERAL jsonb_array_elements_text(e.props->'patterns') p
        WHERE e.name = 'spin' AND e.created_at >= ${day.start} AND e.created_at < ${day.end}
        GROUP BY p.value`,
      )),
      ...(await this.many(
        'near_miss',
        q.$queryRaw<Row[]>`
        SELECT props->>'nearMiss' AS dimension, count(*)::bigint AS value FROM events
        WHERE name = 'spin' AND props->>'nearMiss' IS NOT NULL
          AND created_at >= ${day.start} AND created_at < ${day.end}
        GROUP BY props->>'nearMiss'`,
      )),
      // Card fates: kept (event), cashed out / extended / restored / burned (ledger by card).
      ...(await this.many(
        'cards',
        q.$queryRaw<Row[]>`
        SELECT 'held' AS dimension, count(*)::bigint AS value FROM events
        WHERE name = 'card_held' AND created_at >= ${day.start} AND created_at < ${day.end}
        UNION ALL
        SELECT CASE reason WHEN 'cashout' THEN 'cashed_out' WHEN 'card_burn' THEN 'burned'
            WHEN 'extend' THEN 'extended' ELSE 'restored' END,
          count(DISTINCT account_id)::bigint
        FROM ledger_entries
        WHERE account_type = 'card' AND delta < 0
          AND reason IN ('cashout', 'card_burn', 'extend', 'restore')
          AND created_at >= ${day.start} AND created_at < ${day.end}
        GROUP BY reason`,
      )),
      ...(await this.many(
        'pool_redrops',
        q.$queryRaw<Row[]>`
        SELECT NULL AS dimension, count(*)::bigint AS value FROM events
        WHERE name = 'spin' AND props->>'source' = 'pool'
          AND created_at >= ${day.start} AND created_at < ${day.end}`,
      )),
      // Factual RTP of paid spins per pack: issued card balances / price, in basis points.
      ...(await this.many(
        'rtp_bp',
        q.$queryRaw<Row[]>`
        SELECT props->>'packId' || ':' || (props->>'currency') AS dimension,
          (sum((props->>'issued')::numeric) * 10000 / NULLIF(sum((props->>'price')::numeric), 0))::bigint AS value
        FROM events
        WHERE name = 'spin' AND (props->>'price')::numeric > 0
          AND created_at >= ${day.start} AND created_at < ${day.end}
        GROUP BY 1`,
      )),
    ];
  }

  private async economy(day: Bounds) {
    const flows = await this.prisma.$queryRaw<{ currency: string; reason: string; net: bigint }[]>`
      SELECT currency, reason::text AS reason, sum(delta)::bigint AS net FROM ledger_entries
      WHERE created_at >= ${day.start} AND created_at < ${day.end}
      GROUP BY currency, reason`;
    return [
      ...flows.map((f) => ({
        metric: 'money_flow',
        dimension: `${f.currency}:${f.reason}`,
        value: f.net,
      })),
      ...emissionAndBurn(flows),
      ...(await this.many(
        'conversions',
        this.prisma.$queryRaw<Row[]>`
        SELECT from_currency || '>' || to_currency AS dimension, count(*)::bigint AS value
        FROM currency_conversions
        WHERE created_at >= ${day.start} AND created_at < ${day.end}
        GROUP BY 1`,
      )),
      ...(await this.many(
        'conversions_amount',
        this.prisma.$queryRaw<Row[]>`
        SELECT from_currency AS dimension, sum(amount_from)::bigint AS value
        FROM currency_conversions
        WHERE created_at >= ${day.start} AND created_at < ${day.end}
        GROUP BY 1`,
      )),
    ];
  }

  private async growth(day: Bounds) {
    const q = this.prisma;
    return [
      ...(await this.many(
        'referrals',
        q.$queryRaw<Row[]>`
        SELECT 'invited' AS dimension, count(*)::bigint AS value FROM referrals
        WHERE created_at >= ${day.start} AND created_at < ${day.end}
        UNION ALL
        SELECT 'rewarded', count(*)::bigint FROM referrals
        WHERE rewarded_at >= ${day.start} AND rewarded_at < ${day.end}`,
      )),
      ...(await this.many(
        'bot',
        q.$queryRaw<Row[]>`
        SELECT CASE name WHEN 'bot_start' THEN 'starts' WHEN 'bot_blocked' THEN 'blocks'
            ELSE 'unblocks' END AS dimension, count(*)::bigint AS value
        FROM events WHERE name IN ('bot_start', 'bot_blocked', 'bot_unblocked')
          AND created_at >= ${day.start} AND created_at < ${day.end}
        GROUP BY name`,
      )),
      ...(await this.many(
        'notifications',
        q.$queryRaw<Row[]>`
        SELECT 'sent:' || kind AS dimension, count(*)::bigint AS value FROM notifications_outbox
        WHERE status = 'sent' AND sent_at >= ${day.start} AND sent_at < ${day.end} GROUP BY kind
        UNION ALL
        SELECT 'failed:' || kind, count(*)::bigint FROM notifications_outbox
        WHERE status = 'failed' AND scheduled_at >= ${day.start} AND scheduled_at < ${day.end}
        GROUP BY kind`,
      )),
      ...(await this.many(
        'stars_payments',
        q.$queryRaw<Row[]>`
        SELECT 'count' AS dimension, count(*)::bigint AS value FROM payments
        WHERE status = 'paid' AND paid_at >= ${day.start} AND paid_at < ${day.end}
        UNION ALL
        SELECT 'stars', COALESCE(sum(stars_amount), 0)::bigint FROM payments
        WHERE status = 'paid' AND paid_at >= ${day.start} AND paid_at < ${day.end}`,
      )),
    ];
  }

  /** Point-in-time metrics: wallet balances per currency, pool size, notification queue. */
  private async snapshot(): Promise<MetricRow[]> {
    const rows: MetricRow[] = [];
    const wallets = await this.prisma.wallet.findMany({
      select: { currency: true, balance: true },
    });
    const byCurrency = new Map<string, bigint[]>();
    for (const w of wallets)
      byCurrency.set(w.currency, [...(byCurrency.get(w.currency) ?? []), w.balance]);
    for (const [currency, balances] of byCurrency) {
      const total = balances.reduce((s, b) => s + b, 0n);
      rows.push(
        { metric: 'balance_avg', dimension: currency, value: total / BigInt(balances.length) },
        { metric: 'balance_median', dimension: currency, value: median(balances) },
        { metric: 'balance_top1_share_bp', dimension: currency, value: topShareBp(balances) },
      );
    }
    const pool = await this.prisma.card.count({ where: { status: 'pooled' } });
    rows.push({ metric: 'pool_size', dimension: '', value: BigInt(pool) });
    const queue = await this.prisma.notificationOutbox.count({ where: { status: 'pending' } });
    rows.push({ metric: 'notifications_queue', dimension: '', value: BigInt(queue) });
    return rows;
  }

  /** Replaces the day's rows of the computed metrics (`keep` metrics are left untouched). */
  private async replace(
    date: string,
    rows: MetricRow[],
    keep: readonly string[],
    only?: readonly string[],
  ): Promise<void> {
    const day = new Date(`${date}T00:00:00Z`);
    await this.prisma.transaction(async (tx) => {
      await tx.dailyStat.deleteMany({
        where: {
          date: day,
          ...(only
            ? { metric: { in: [...only] } }
            : { metric: { notIn: [...keep, ...COHORT_METRICS] } }),
        },
      });
      if (rows.length > 0)
        await tx.dailyStat.createMany({
          data: rows.map((r) => ({
            date: day,
            metric: r.metric,
            dimension: r.dimension,
            value: r.value,
          })),
        });
    });
  }

  /**
   * A calendar day in the analytics timezone, starting no earlier than the statistics start
   * (D-152). A day wholly before it is empty (start = end), so nothing is counted for it.
   */
  private async bounds(date: string, tz: string): Promise<Bounds> {
    const day = await this.prisma.$queryRaw<Bounds[]>`
      SELECT (${date}::date::timestamp AT TIME ZONE ${tz}) AS start,
        ((${date}::date + 1)::timestamp AT TIME ZONE ${tz}) AS "end"`.then((r) => r[0] as Bounds);
    const { config } = await this.config.active();
    if (!config.analytics.since) return day;
    const since = new Date(config.analytics.since);
    const start = day.start > since ? day.start : since;
    return { start, end: day.end > start ? day.end : start };
  }

  private async one(metric: string, query: Promise<Row[]>): Promise<MetricRow> {
    const row = (await query)[0];
    return { metric, dimension: '', value: BigInt(row?.value ?? 0) };
  }

  private async many(metric: string, query: Promise<Row[]>): Promise<MetricRow[]> {
    return (await query)
      .filter((r) => r.value !== null)
      .map((r) => ({ metric, dimension: r.dimension ?? '', value: BigInt(r.value ?? 0) }));
  }
}

/** Point-in-time metrics: computed for the current day only and kept afterwards. */
const SNAPSHOT_METRICS = [
  'balance_avg',
  'balance_median',
  'balance_top1_share_bp',
  'pool_size',
  'notifications_queue',
] as const;

/** Stored under the cohort's signup date by computeCohort. */
const COHORT_METRICS = [
  'cohort_size',
  ...RETENTION_DAYS.map((n) => `retained_d${String(n)}`),
  'funnel',
] as const;
