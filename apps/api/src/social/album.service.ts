import { Injectable } from '@nestjs/common';
import {
  type AlbumResponse,
  type SeasonCollectionResponse,
  type Tier,
  TIERS,
} from '@spincards/shared';
import { FlagsService } from '../game-config/flags.service.js';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { toCardView } from '../game/card-view.js';
import { albumIncomeAmount, nextClaimAt } from '../game/income.js';
import { CardStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The album of trophies (D-129): cards the player chose to keep and show, and the season
 * collection (D-130): which bank × tier pairs the player has dropped this season.
 */
@Injectable()
export class AlbumService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly flags: FlagsService,
  ) {}

  async album(userId: string): Promise<AlbumResponse> {
    const { config } = await this.config.active();
    const [user, trophies, stars, incomeOn] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.trophies(userId),
      this.flags.isEnabled('stars_enabled'),
      this.flags.isEnabled('album_income_enabled'),
    ]);
    const total = config.showcase.freeSlots + user.showcaseSlots;
    // D-172: paid in the currency of the player's region.
    const currency = config.regions[user.region].currency;
    const income = incomeOn ? config.albumIncome : undefined;
    return {
      slots: { used: trophies.length, total, free: config.showcase.freeSlots },
      trophies: trophies.map((c) => toCardView(c, config, user.level)),
      extraSlotStars: stars ? config.showcase.extraSlotStars : null,
      income: income
        ? {
            amount: albumIncomeAmount(trophies, income, currency),
            currency,
            availableAt:
              nextClaimAt(user.albumIncomeAt, income.intervalHours, new Date())?.toISOString() ??
              null,
          }
        : null,
    };
  }

  /** Trophies, the rarest first. */
  trophies(userId: string) {
    return this.prisma.card.findMany({
      where: { ownerId: userId, status: CardStatus.trophy },
      orderBy: [{ rarityScore: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async seasonCollection(userId: string): Promise<SeasonCollectionResponse> {
    const season = await this.seasons.current();
    const [banks, dropped] = await Promise.all([
      this.prisma.bank.findMany({ orderBy: [{ region: 'asc' }, { sortOrder: 'asc' }] }),
      this.prisma.$queryRaw<{ bankId: string; tier: Tier; at: Date; number: string }[]>`
        SELECT DISTINCT ON (c.bank_id, c.tier) c.bank_id AS "bankId", c.tier, s.created_at AS at,
          c.number
        FROM spins s JOIN cards c ON c.id = s.card_id
        WHERE s.user_id = ${userId}::uuid AND s.season_id = ${season.id}::uuid
        ORDER BY c.bank_id, c.tier, s.created_at`,
    ]);
    const found = new Map(dropped.map((d) => [`${d.bankId}:${d.tier}`, d]));
    const views = banks.map((bank) => ({
      id: bank.id,
      name: bank.name,
      region: bank.region,
      color: bank.color,
      tiers: Object.fromEntries(
        TIERS.map((tier) => {
          const d = found.get(`${bank.id}:${tier}`);
          return [tier, d ? { at: d.at.toISOString(), number: d.number } : null];
        }),
      ) as Record<Tier, { at: string; number: string } | null>,
    }));
    return {
      season: season.name,
      collected: dropped.length,
      total: banks.length * TIERS.length,
      banks: views,
    };
  }
}
