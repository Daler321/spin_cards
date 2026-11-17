import { HttpStatus, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ErrorCode } from '@spincards/shared';
import { AppError } from '../common/app-error.js';
import { RefreshingCache } from '../common/refreshing-cache.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type FeatureFlag =
  | 'stars_enabled'
  | 'near_miss_ux'
  | 'maintenance_mode'
  | 'minigames_enabled'
  | 'craft_enabled'
  | 'album_income_enabled'
  | 'nick_bonus_enabled';

const CACHE_MS = 5000;

@Injectable()
export class FlagsService implements OnApplicationBootstrap {
  private readonly cache = new RefreshingCache(CACHE_MS, async () => {
    const rows = await this.prisma.featureFlag.findMany();
    return new Map(rows.map((r) => [r.key, r.enabled]));
  });

  constructor(private readonly prisma: PrismaService) {}

  /** Warm-up: the first read must not happen inside a transaction (D-118). */
  async onApplicationBootstrap(): Promise<void> {
    await this.cache.get();
  }

  async isEnabled(flag: FeatureFlag): Promise<boolean> {
    return (await this.cache.get()).get(flag) ?? false;
  }

  /** A pack paused by the RTP safeguard or by an admin (flag `pack_paused:<id>`, D-103). */
  async isPackPaused(packId: string): Promise<boolean> {
    return (await this.cache.get()).get(packPauseFlag(packId)) ?? false;
  }

  /** Game actions are rejected while maintenance mode is on. */
  async assertNotMaintenance(): Promise<void> {
    if (await this.isEnabled('maintenance_mode')) {
      throw new AppError(ErrorCode.MAINTENANCE, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  /** Reloads now (other processes follow within CACHE_MS). */
  async invalidate(): Promise<void> {
    await this.cache.refresh();
  }
}

export const packPauseFlag = (packId: string) => `pack_paused:${packId}`;
