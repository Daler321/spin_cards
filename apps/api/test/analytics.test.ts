import type { LeaderboardResponse, SpinResponse } from '@spincards/shared';
import { randomInt, randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DailyStatsService } from '../src/analytics/daily-stats.service.js';
import { GameConfigService } from '../src/game-config/game-config.service.js';
import {
  addDays,
  emissionAndBurn,
  localDate,
  median,
  topShareBp,
} from '../src/analytics/metrics.js';
import { LeaderboardService } from '../src/leaderboard/leaderboard.service.js';
import { REDIS } from '../src/redis/redis.module.js';
import {
  createTestApp,
  fund,
  login,
  markPlayed,
  post,
  type Session,
  type TestApp,
} from './support/app.js';

type ErrorBody = { error: { code: string } };

describe('metric helpers', () => {
  it('computes median, top-1% share and emission/burn', () => {
    expect(median([])).toBe(0n);
    expect(median([5n, 1n, 3n])).toBe(3n);
    expect(median([4n, 1n, 3n, 2n])).toBe(2n);
    const balances = [...Array.from({ length: 99 }, () => 1n), 901n];
    expect(topShareBp(balances)).toBe(9010n);
    expect(
      emissionAndBurn([
        { currency: 'RUB', reason: 'card_issue', net: 1000n },
        { currency: 'RUB', reason: 'spin_cost', net: -1200n },
        { currency: 'RUB', reason: 'cashout', net: -50n },
        { currency: 'USD', reason: 'convert_in', net: 7n },
      ]),
    ).toEqual([
      { metric: 'emission', dimension: 'RUB', value: 1000n },
      { metric: 'emission', dimension: 'USD', value: 7n },
      { metric: 'burn', dimension: 'RUB', value: 1250n },
    ]);
  });

  it('counts days in the analytics timezone', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    // 22:30 UTC is already the next day in Moscow.
    expect(localDate(new Date('2026-10-13T22:30:00Z'), 'Europe/Moscow')).toBe('2026-10-14');
  });
});

describe('leaderboards in Redis', () => {
  let t: TestApp;
  let service: LeaderboardService;
  const prefix = `test-lb-${randomUUID()}`;

  beforeAll(async () => {
    // Own key prefix: other test files keep reading their boards from SQL.
    t = await createTestApp({ LEADERBOARD_KEY_PREFIX: prefix });
    service = t.app.get(LeaderboardService);
  });

  afterAll(async () => {
    const keys = await t.redis.keys(`${prefix}:*`);
    if (keys.length > 0) await t.redis.del(...keys);
    await t.close();
  });

  const board = async (session: Session, type: 'balance' | 'collection' = 'balance') =>
    (
      await t.app.inject({ url: `/v1/leaderboard?type=${type}`, headers: session.auth })
    ).json<LeaderboardResponse>();

  it('ranks from Redis, one place each: on ties the earlier ranks higher (D-154)', async () => {
    // Relative checks only: other test files add players to the shared DB at any time.
    const a = await login(t, { firstName: 'Альфа' });
    const b = await login(t, { firstName: 'Бета' });
    await fund(t, a.userId, 'RUB', 123_457n);
    await fund(t, b.userId, 'RUB', 123_457n);
    await markPlayed(t, a.userId);
    await markPlayed(t, b.userId);
    await service.rebuild();
    await service.sync();

    const rankOf = async (s: Session) => (await board(s)).me?.rank ?? 0;
    // Same score, reached in the same rebuild: the older account first, each in its own place.
    const first = await rankOf(a);
    expect(first).toBeGreaterThan(0);
    expect(await rankOf(b)).toBe(first + 1);

    // A change is invisible until the next sync, then counted.
    await fund(t, b.userId, 'RUB', 1n);
    expect(await rankOf(b)).toBe(first + 1);
    await service.sync();
    expect(await rankOf(b)).toBeLessThan(await rankOf(a));

    // A catches up later: equal again, and B, who got there first, stays above.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await fund(t, a.userId, 'RUB', 1n);
    await service.sync();
    expect(await rankOf(b)).toBe((await rankOf(a)) - 1);

    // Hiding applies at once (no sync needed).
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/settings',
      headers: b.auth,
      payload: { hideFromLeaderboard: true },
    });
    expect(res.statusCode).toBe(204);
    expect((await board(b)).me).toBeNull();
  });

  it('puts players with live cards on the collection board', async () => {
    const session = await login(t);
    const spin = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    await post(t, session, `/v1/cards/${spin.body.spins[0]!.card.id}/hold`);
    await service.sync();
    const collection = await board(session, 'collection');
    expect(collection.me?.score).toBe(spin.body.spins[0]!.card.rarityScore);
  });

  it('falls back to SQL when Redis fails', async () => {
    const session = await login(t);
    await markPlayed(t, session.userId);
    const redis = t.app.get<Redis>(REDIS);
    const spy = vi.spyOn(redis, 'get').mockRejectedValueOnce(new Error('down'));
    const res = await t.app.inject({ url: '/v1/leaderboard?type=balance', headers: session.auth });
    expect(res.statusCode).toBe(200);
    expect(res.json<LeaderboardResponse>().me).not.toBeNull();
    spy.mockRestore();
  });

  it('snapshots the top and keeps only the daily record after a week', async () => {
    const now = new Date();
    const { rows } = await service.snapshot(now);
    expect(rows).toBeGreaterThan(0);
    expect(await t.prisma.leaderboardSnapshot.count({ where: { takenAt: now } })).toBe(rows);

    const season = await t.prisma.season.findFirstOrThrow({ where: { status: 'active' } });
    const user = await login(t);
    const old = (iso: string) => ({
      seasonId: season.id,
      type: 'balance' as const,
      userId: user.userId,
      score: 1n,
      rank: 1,
      takenAt: new Date(iso),
    });
    await t.prisma.leaderboardSnapshot.createMany({
      data: [old('2001-01-02T00:00:00Z'), old('2001-01-02T00:05:00Z'), old('2001-01-02T13:40:00Z')],
    });
    await service.snapshot(now);
    const left = await t.prisma.leaderboardSnapshot.findMany({
      where: { userId: user.userId, takenAt: { lt: new Date('2002-01-01') } },
    });
    expect(left.map((s) => s.takenAt.toISOString())).toEqual(['2001-01-02T00:00:00.000Z']);
  });
});

describe('events and daily stats', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  it('records sign-ups, spins and kept cards with the action, and nothing on failure', async () => {
    const session = await login(t);
    const events = () =>
      t.prisma.event.findMany({ where: { userId: session.userId }, orderBy: { id: 'asc' } });
    expect((await events()).map((e) => e.name)).toEqual(['signup']);

    const spin = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    const card = spin.body.spins[0]!.card;
    await post(t, session, `/v1/cards/${card.id}/hold`);
    const recorded = await events();
    expect(recorded.map((e) => e.name)).toEqual(['signup', 'spin', 'card_held']);
    expect(recorded[1]?.props).toMatchObject({
      packId: 'basic',
      paymentSource: 'wallet',
      tier: card.tier,
      rarityScore: card.rarityScore,
      issued: card.initialBalance,
    });
    // New or re-dropped from the pool (other test files fill the shared pool).
    expect(['new', 'pool']).toContain((recorded[1]?.props as { source: string }).source);

    // A rejected spin (premium is locked at level 1) leaves no event behind.
    const locked = await post<ErrorBody>(t, session, '/v1/spin', {
      packId: 'premium',
      payment: { type: 'wallet' },
    });
    expect(locked.status).toBeGreaterThanOrEqual(400);
    expect(await events()).toHaveLength(3);
  });

  it('accepts only allow-listed client events', async () => {
    const session = await login(t);
    const send = (name: string) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/events',
        headers: session.auth,
        payload: { name },
      });
    expect((await send('app_open')).statusCode).toBe(204);
    expect((await send('spin')).statusCode).toBe(400);
    expect(
      await t.prisma.event.count({ where: { userId: session.userId, name: 'app_open' } }),
    ).toBe(1);
  });

  it('counts nothing before the statistics start, and the start day only after it (D-152)', async () => {
    const service = t.app.get(GameConfigService);
    const original = service.active.bind(service);
    const { versionId, config } = await original();
    service.active = () =>
      Promise.resolve({
        versionId,
        config: {
          ...config,
          analytics: { ...config.analytics, since: '2001-04-10T12:00:00.000Z' },
        },
      });
    try {
      const user = (createdAt: string) =>
        t.prisma.user.create({
          data: {
            telegramId: BigInt(randomInt(1, 2 ** 47)),
            firstName: 'До старта',
            referralCode: randomUUID()
              .replace(/[^A-Z2-9]/gi, '')
              .toUpperCase()
              .slice(0, 8)
              .padEnd(8, 'Y'),
            createdAt: new Date(createdAt),
          },
        });
      await user('2001-04-09T10:00:00Z');
      await user('2001-04-10T10:00:00Z');
      await user('2001-04-10T14:00:00Z');
      const stats = t.app.get(DailyStatsService);
      expect(await stats.computeDay('2001-04-09')).toEqual([]);
      expect(
        await t.prisma.dailyStat.count({ where: { date: new Date('2001-04-09T00:00:00Z') } }),
      ).toBe(0);
      const day = await stats.computeDay('2001-04-10');
      expect(day.find((r) => r.metric === 'new_users')?.value).toBe(1n);
    } finally {
      service.active = original;
    }
  });

  it('aggregates a day and its cohort, and recomputing gives the same rows', async () => {
    // A quiet day in the past that only this test writes to (Moscow time, UTC+3).
    const date = '2001-03-05';
    const at = (iso: string) => new Date(iso);
    const season = await t.prisma.season.findFirstOrThrow({ where: { status: 'active' } });
    const user = (createdAt: string) =>
      t.prisma.user.create({
        data: {
          telegramId: BigInt(randomInt(1, 2 ** 47)),
          firstName: 'Когорта',
          referralCode: randomUUID()
            .replace(/[^A-Z2-9]/gi, '')
            .toUpperCase()
            .slice(0, 8)
            .padEnd(8, 'Z'),
          createdAt: at(createdAt),
        },
      });
    const [u1, u2] = [await user('2001-03-05T08:00:00Z'), await user('2001-03-05T20:30:00Z')];
    // 2001-03-04T22:00Z is already March 5 in Moscow; u2 signed up on March 5 too (23:30 MSK).
    const event = (userId: string, name: string, iso: string, props = {}) => ({
      userId,
      seasonId: season.id,
      name,
      props,
      createdAt: at(iso),
    });
    const spinProps = (
      tier: string,
      issued: number,
      patterns: string[],
      nearMiss: string | null,
    ) => ({
      packId: 'basic',
      paymentSource: 'wallet',
      price: 10_000,
      currency: 'RUB',
      tier,
      rarityScore: 1,
      issued,
      patterns,
      nearMiss,
      source: 'new',
    });
    await t.prisma.event.createMany({
      data: [
        event(u1.id, 'app_open', '2001-03-05T08:00:00Z'),
        event(u1.id, 'app_open', '2001-03-05T08:10:00Z'), // same session
        event(u1.id, 'app_open', '2001-03-05T09:00:00Z'), // new session
        event(u2.id, 'app_open', '2001-03-05T20:30:00Z'),
        event(
          u1.id,
          'spin',
          '2001-03-05T08:01:00Z',
          spinProps('rare', 15_000, ['tail_9999'], 'pair'),
        ),
        event(u1.id, 'spin', '2001-03-05T08:02:00Z', spinProps('common', 5_000, [], null)),
        event(u1.id, 'card_held', '2001-03-05T08:03:00Z'),
        event(u1.id, 'app_open', '2001-03-06T10:00:00Z'), // day 1
        event(u2.id, 'app_open', '2001-03-11T10:00:00Z'), // day 6 -> "day 7" of the funnel
        event(u1.id, 'app_open', '2001-03-12T10:00:00Z'), // day 7
      ],
    });

    const stats = t.app.get(DailyStatsService);
    const rows = await stats.computeDay(date);
    const value = (metric: string, dimension = '') =>
      rows.find((r) => r.metric === metric && r.dimension === dimension)?.value;
    expect(value('new_users')).toBe(2n);
    expect(value('dau')).toBe(2n);
    expect(value('sessions')).toBe(3n);
    expect(value('spins_by_tier', 'rare')).toBe(1n);
    expect(value('spins_by_tier', 'common')).toBe(1n);
    expect(value('patterns', 'tail_9999')).toBe(1n);
    expect(value('near_miss', 'pair')).toBe(1n);
    expect(value('cards', 'held')).toBe(1n);
    expect(value('rtp_bp', 'basic:RUB')).toBe(10_000n); // 20 000 issued for 20 000 paid

    const cohort = await stats.computeCohort(date, '2001-04-30');
    const c = (metric: string, dimension = '') =>
      cohort.find((r) => r.metric === metric && r.dimension === dimension)?.value;
    expect(c('cohort_size')).toBe(2n);
    expect(c('retained_d1')).toBe(1n);
    expect(c('retained_d7')).toBe(1n);
    expect(c('retained_d30')).toBe(0n);
    expect(c('funnel', 'day_2')).toBe(1n);
    expect(c('funnel', 'day_7')).toBe(1n);

    // Idempotent: the stored rows are replaced, not duplicated.
    await stats.computeDay(date);
    await stats.computeCohort(date, '2001-04-30');
    const stored = await t.prisma.dailyStat.findMany({
      where: { date: new Date(`${date}T00:00:00Z`) },
    });
    expect(stored).toHaveLength(rows.length + cohort.length);
    expect(stored.find((s) => s.metric === 'sessions')?.value).toBe(3n);
  });
});
