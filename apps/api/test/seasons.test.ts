import { seasonScore } from '@spincards/game-core';
import {
  DEFAULT_GAME_CONFIG,
  type LeaderboardResponse,
  type SpinResponse,
} from '@spincards/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FlagsService } from '../src/game-config/flags.service.js';
import { GameConfigService } from '../src/game-config/game-config.service.js';
import { SeasonService } from '../src/game-config/season.service.js';
import { AchievementsService } from '../src/game/achievements.service.js';
import { nextSeasonName, SeasonRolloverService } from '../src/game/season-rollover.service.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { findLedgerMismatches } from '../src/ledger/verify.js';
import { LeaderboardService } from '../src/leaderboard/leaderboard.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { createTestApp, fund, get, login, post, type TestApp } from './support/app.js';

describe('seasons (D-125, D-132)', () => {
  let t: TestApp;
  let rollover: SeasonRolloverService;
  beforeAll(async () => {
    t = await createTestApp();
    rollover = new SeasonRolloverService(
      t.prisma,
      t.app.get(GameConfigService),
      t.app.get(SeasonService),
      t.app.get(LedgerService),
      t.app.get(NotificationsService),
      t.app.get(AchievementsService),
      t.app.get(FlagsService),
      t.app.get(LeaderboardService),
    );
  });
  afterAll(() => t.close());

  it('ranks the season by cards, net worth and level', async () => {
    const session = await login(t);
    const spin = await post<SpinResponse>(t, session, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    const card = spin.body.spins[0]!.card;
    await post(t, session, `/v1/cards/${card.id}/cashout`);
    const board = await get<LeaderboardResponse>(t, session, '/v1/leaderboard?type=season');
    const stats = await get<{ season: { score: { cards: number; total: number } } }>(
      t,
      session,
      '/v1/me/stats',
    );
    expect(stats.season.score.cards).toBe(card.rarityScore);
    expect(board.me?.score).toBe(stats.season.score.total);
    expect(stats.season.score.total).toBeGreaterThan(card.rarityScore);
    expect(board.season?.medals.map((m) => m.achievementId)).toEqual(
      DEFAULT_GAME_CONFIG.seasons.medals.map((m) => m.achievementId),
    );
  });

  it('closes a season with medals, then starts players over with a score bonus', async () => {
    // One by one: on equal scores the older account ranks higher (D-154).
    const players = [await login(t), await login(t), await login(t)] as const;
    // Seasons of their own, so the active one used by other test files stays untouched.
    const season = await t.prisma.season.create({
      data: { name: 'Тестовый сезон', status: 'planned', startsAt: new Date(), endsAt: new Date() },
    });
    const next = await t.prisma.season.create({
      data: { name: 'Следующий', status: 'planned', startsAt: new Date() },
    });
    const points = [500n, 900n, 500n];
    for (const [i, p] of players.entries())
      await t.prisma.userSeasonStat.create({
        data: { userId: p.userId, seasonId: season.id, points: points[i]! },
      });
    const config = structuredClone(DEFAULT_GAME_CONFIG);
    config.startingBalance = { RUB: 3_000_000 };

    await rollover.close(season.id, config, { openNext: false });
    await rollover.close(season.id, config, { openNext: false }); // a repeat does nothing new

    const results = await t.prisma.seasonResult.findMany({ where: { seasonId: season.id } });
    const byUser = new Map(results.map((r) => [r.userId, r]));
    // D-154: equal scores get their own places; without a "reached at" the older account is first.
    expect(byUser.get(players[1].userId)?.rank).toBe(1);
    expect(byUser.get(players[0].userId)?.rank).toBe(2);
    expect(byUser.get(players[2].userId)?.rank).toBe(3);
    const medals = await t.prisma.userAchievement.findMany({
      where: { scope: season.id },
      orderBy: { achievementId: 'asc' },
    });
    expect(medals.map((m) => [m.userId, m.achievementId])).toEqual(
      expect.arrayContaining([
        [players[1].userId, 'season_top1'],
        [players[0].userId, 'season_top3'],
        [players[2].userId, 'season_top3'],
      ]),
    );
    expect(
      await t.prisma.notificationOutbox.count({
        where: { kind: 'season_result', userId: { in: players.map((p) => p.userId) } },
      }),
    ).toBe(3);
    expect((await t.prisma.season.findUniqueOrThrow({ where: { id: season.id } })).status).toBe(
      'finished',
    );

    // Start over: cards burn, money = start + carryover, level 1.
    const winner = players[1];
    await fund(t, winner.userId, 'RUB', 1_000_000n);
    const spin = await post<SpinResponse>(t, winner, '/v1/spin', {
      packId: 'basic',
      payment: { type: 'wallet' },
    });
    const cardId = spin.body.spins[0]!.card.id;
    await t.prisma.user.update({ where: { id: winner.userId }, data: { level: 12, exp: 9000 } });
    await rollover.resetPlayer(winner.userId, next, config);
    await rollover.resetPlayer(winner.userId, next, config); // a repeat does nothing

    const carry = Number(byUser.get(winner.userId)?.reward ?? 0n);
    expect(carry).toBeGreaterThan(0);
    const wallet = await t.prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: winner.userId, currency: 'RUB' } },
    });
    expect(wallet.balance).toBe(BigInt(3_000_000 + carry));
    expect(await t.prisma.card.findUniqueOrThrow({ where: { id: cardId } })).toMatchObject({
      status: 'cashed',
      ownerId: null,
      balance: 0n,
    });
    expect(await t.prisma.user.findUniqueOrThrow({ where: { id: winner.userId } })).toMatchObject({
      level: 1,
      exp: 0,
      moneySeasonId: next.id,
    });

    // D-156: a player who played in dollars starts the new season in rubles, bonus included.
    const dollar = players[2];
    await t.prisma.user.update({ where: { id: dollar.userId }, data: { region: 'US' } });
    await fund(t, dollar.userId, 'USD', 5_000n);
    await rollover.resetPlayer(dollar.userId, next, config);
    const dollarCarry = Number(byUser.get(dollar.userId)?.reward ?? 0n);
    expect(byUser.get(dollar.userId)?.currency).toBe('RUB');
    const dollarWallets = await t.prisma.wallet.findMany({ where: { userId: dollar.userId } });
    expect(dollarWallets.find((w) => w.currency === 'RUB')?.balance).toBe(
      BigInt(3_000_000 + dollarCarry),
    );
    expect(dollarWallets.find((w) => w.currency === 'USD')?.balance).toBe(0n);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: dollar.userId } })).region).toBe(
      'RU',
    );

    const stats = await get<{ pastSeasons: { name: string; rank: number }[] }>(
      t,
      winner,
      '/v1/me/stats',
    );
    expect(stats.pastSeasons[0]).toMatchObject({ name: 'Тестовый сезон', rank: 1 });
    expect(await findLedgerMismatches(t.prisma)).toEqual([]);
  });

  it('numbers seasons on from the last «Сезон N», skipping test seasons (D-160)', () => {
    expect(nextSeasonName(['Альфа', 'Бета'])).toBe('Сезон 1');
    expect(nextSeasonName(['Альфа', 'Бета', 'Сезон 1'])).toBe('Сезон 2');
    expect(nextSeasonName(['Сезон 2', 'Тестовый сезон', 'Сезон 10'])).toBe('Сезон 11');
  });

  it('computes the score from its parts', () => {
    expect(
      seasonScore(
        { cardPoints: 100, netWorthRub: 250_000, level: 3 },
        DEFAULT_GAME_CONFIG.seasons.score,
      ),
    ).toEqual({ cards: 100, money: 2, level: 60, total: 162 });
  });
});
