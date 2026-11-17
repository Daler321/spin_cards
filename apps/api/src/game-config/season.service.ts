import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { RefreshingCache } from '../common/refreshing-cache.js';
import { type Season, SeasonStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** A new season is picked up by every process within this delay (D-125). */
const CACHE_MS = 10_000;

@Injectable()
export class SeasonService implements OnApplicationBootstrap {
  private readonly cache = new RefreshingCache<Season>(CACHE_MS, async () => {
    const season = await this.prisma.season.findFirst({
      where: { status: SeasonStatus.active },
      orderBy: { startsAt: 'desc' },
    });
    if (!season) throw new Error('no active season');
    return season;
  });

  constructor(private readonly prisma: PrismaService) {}

  /** Warm-up: the first read must not happen inside a transaction (D-118). */
  async onApplicationBootstrap(): Promise<void> {
    await this.cache.get().catch(() => undefined); // before the seed there is no season yet
  }

  /** The single active season; every season-scoped row is written against it. */
  async currentSeasonId(): Promise<string> {
    return (await this.cache.get()).id;
  }

  current(): Promise<Season> {
    return this.cache.get();
  }

  /** Reloads now, e.g. after a season ended or its end date changed. */
  async refresh(): Promise<void> {
    await this.cache.refresh();
  }
}
