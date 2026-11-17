import { Injectable } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { collectionLevel, seasonScore } from '@spincards/game-core';
import { ErrorCode } from '@spincards/shared';
import type {
  SeasonsResponse,
  PlayerProfileResponse,
  LeaderboardResponse,
  LeaderboardType,
  ProfileStats,
  SettingsRequest,
} from '@spincards/shared';
import { CardStatus } from '../generated/prisma/client.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { CardsService } from '../game/cards.service.js';
import { LeaderboardService } from '../leaderboard/leaderboard.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppError } from '../common/app-error.js';
import { toCardView } from '../game/card-view.js';
import { medalIcons, shownMedals } from '../game/medals.js';
import { seasonStandings } from '../game/season-score.js';
import { normalizeUsername } from '../wallet/p2p.service.js';

/** Leaderboards (read from LeaderboardService), player settings and profile stats. */
@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly cards: CardsService,
    private readonly leaderboards: LeaderboardService,
  ) {}

  /** D-177: «Сезон N» numbers come from the name (test seasons have none, D-160). */
  async seasonsInfo(): Promise<SeasonsResponse> {
    const current = await this.seasons.current();
    const past = await this.prisma.season.findMany({
      where: { startsAt: { lt: current.startsAt } },
      orderBy: { startsAt: 'desc' },
      take: 20,
    });
    const number = /^Сезон (\d+)$/.exec(current.name.trim())?.[1];
    return {
      current: {
        name: current.name,
        number: number ? Number(number) : null,
        startsAt: current.startsAt.toISOString(),
        endsAt: current.endsAt?.toISOString() ?? null,
        finished: past.length,
      },
      past: past.map((s) => ({
        name: s.name,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt?.toISOString() ?? null,
      })),
    };
  }

  async playerByUsername(viewerId: string, username: string): Promise<PlayerProfileResponse> {
    const name = normalizeUsername(username);
    const user = /^[a-z0-9_]{3,32}$/.test(name)
      ? await this.prisma.user.findFirst({
          where: { username: { equals: name, mode: 'insensitive' } },
          select: { id: true },
        })
      : null;
    if (!user) throw new AppError(ErrorCode.PLAYER_NOT_FOUND, HttpStatus.NOT_FOUND);
    return this.player(viewerId, user.id).catch((error: unknown) => {
      throw error instanceof AppError
        ? new AppError(ErrorCode.PLAYER_NOT_FOUND, HttpStatus.NOT_FOUND)
        : error;
    });
  }

  leaderboard(userId: string, type: LeaderboardType): Promise<LeaderboardResponse> {
    return this.leaderboards.read(userId, type);
  }

  async updateSettings(userId: string, settings: SettingsRequest): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(settings.notificationsEnabled !== undefined && {
          notificationsEnabled: settings.notificationsEnabled,
        }),
        ...(settings.hideFromLeaderboard !== undefined && {
          hideFromLeaderboard: settings.hideFromLeaderboard,
        }),
        // Only the order and uniqueness matter here; unearned ids are never shown (D-137).
        ...(settings.pinnedMedals !== undefined && {
          pinnedMedals: [...new Set(settings.pinnedMedals)],
        }),
        ...(settings.autoCashoutTiers !== undefined && {
          autoCashoutTiers: [...new Set(settings.autoCashoutTiers)],
        }),
      },
    });
    // Hiding takes effect at once; if Redis is down the next rebuild applies it.
    if (settings.hideFromLeaderboard !== undefined)
      await this.leaderboards.refresh([userId]).catch(() => undefined);
  }

  /** Public profile (TZ 7.3 rating): hidden and banned players are not shown to others. */
  async player(viewerId: string, userId: string): Promise<PlayerProfileResponse> {
    const { config } = await this.config.active();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || (viewerId !== userId && (user.hideFromLeaderboard || user.isBanned)))
      throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
    const live = await this.prisma.card.findMany({
      where: { ownerId: userId, status: { in: [CardStatus.active, CardStatus.expired] } },
      orderBy: [{ rarityScore: 'desc' }, { balance: 'desc' }],
    });
    const score = live.reduce((sum, c) => sum + c.rarityScore, 0);
    const trophies = await this.prisma.card.findMany({
      where: { ownerId: userId, status: CardStatus.trophy },
      orderBy: [{ rarityScore: 'desc' }, { updatedAt: 'desc' }],
    });
    const medals = (await shownMedals(this.prisma, config, [user.id])).get(user.id)?.ids ?? [];
    const seasonId = await this.seasons.currentSeasonId();
    const stat = await this.prisma.userSeasonStat.findUnique({
      where: { userId_seasonId: { userId, seasonId } },
      select: { spinsCount: true },
    });
    return {
      userId: user.id,
      medals: medalIcons(medals, config),
      firstName: user.firstName,
      photoUrl: user.photoUrl,
      level: user.level,
      totalSpins: user.totalSpins,
      seasonSpins: stat?.spinsCount ?? 0,
      memberSince: user.createdAt.toISOString(),
      collection: { score, ...collectionLevel(score, config), cards: live.length },
      topCards: live.slice(0, 6).map((c) => toCardView(c, config, user.level)),
      trophies: trophies.map((c) => toCardView(c, config, user.level)),
    };
  }

  async stats(userId: string): Promise<ProfileStats> {
    const { config } = await this.config.active();
    const seasonId = await this.seasons.currentSeasonId();
    const [[standing], user, season, stat, cards, slots, past] = await Promise.all([
      seasonStandings(this.prisma, seasonId, [userId]),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totalSpins: true } }),
      this.prisma.season.findUniqueOrThrow({ where: { id: seasonId } }),
      this.prisma.userSeasonStat.findUnique({ where: { userId_seasonId: { userId, seasonId } } }),
      this.prisma.card.count({
        where: {
          ownerId: userId,
          status: { in: [CardStatus.active, CardStatus.expired] },
          heldAt: { not: null },
        },
      }),
      this.cards.totalSlots(this.prisma, userId, config),
      this.prisma.seasonResult.findMany({
        where: { userId },
        include: { season: { select: { name: true, startsAt: true } } },
        orderBy: { season: { startsAt: 'desc' } },
        take: 10,
      }),
    ]);
    return {
      totalSpins: user.totalSpins,
      season: {
        name: season.name,
        spins: stat?.spinsCount ?? 0,
        cardsIssued: stat?.cardsIssued ?? 0,
        bestRarity: stat?.bestRarity ?? 0,
        cashedOut: Number(stat?.cashedOutMinor ?? 0n),
        score: seasonScore(
          {
            cardPoints: Number(stat?.points ?? 0n),
            netWorthRub: Number(standing?.netWorthRub ?? 0n),
            level: standing?.level ?? 1,
          },
          config.seasons.score,
        ),
      },
      pastSeasons: past.map((r) => ({
        name: r.season.name,
        rank: r.rank,
        points: Number(r.points),
      })),
      holder: { cards, slots },
    };
  }
}
