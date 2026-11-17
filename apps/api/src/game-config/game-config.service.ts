import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { RefreshingCache } from '../common/refreshing-cache.js';
import { DEFAULT_GAME_CONFIG, type GameConfig, GameConfigSchema } from '@spincards/shared';
import { ConfigStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { fillMissing } from '../seed/config-upgrade.js';

export interface ActiveConfig {
  versionId: number;
  config: GameConfig;
}

/** Cache lifetime: a newly activated version applies to new spins within this delay. */
const CACHE_MS = 5000;

@Injectable()
export class GameConfigService implements OnApplicationBootstrap {
  private readonly activeCache = new RefreshingCache(CACHE_MS, async () => {
    const row = await this.prisma.gameConfigVersion.findFirst({
      where: { status: ConfigStatus.active },
    });
    if (!row) throw new Error('no active game config version');
    return { versionId: row.id, config: parseConfig(row.payload) };
  });

  private readonly experimentsCache = new RefreshingCache(CACHE_MS, async () => {
    const rows = await this.prisma.gameConfigExperiment.findMany({ include: { version: true } });
    return new Map(
      rows.map((r): [string, ActiveConfig] => [
        r.group,
        { versionId: r.versionId, config: parseConfig(r.version.payload) },
      ]),
    );
  });

  constructor(private readonly prisma: PrismaService) {}

  /** Warm-up: the first read must not happen inside a transaction (D-118). */
  async onApplicationBootstrap(): Promise<void> {
    await Promise.all([this.activeCache.get(), this.experimentsCache.get()]).catch(
      () => undefined, // a database without a config yet (before the seed) still starts
    );
  }

  active(): Promise<ActiveConfig> {
    return this.activeCache.get();
  }

  /**
   * The config of a player's spins: the version bound to their experiment group (A/B stub,
   * TZ 15.2), or the active one.
   */
  async forGroup(group: string | null): Promise<ActiveConfig> {
    if (!group) return this.active();
    return (await this.experimentsCache.get()).get(group) ?? this.active();
  }

  /** Reloads now, e.g. after activating another version (other processes follow within CACHE_MS). */
  async invalidate(): Promise<void> {
    await Promise.all([this.activeCache.refresh(), this.experimentsCache.refresh()]);
  }
}

/** Keys added by a newer release read their defaults until the seed stores them (D-091). */
export function parseConfig(payload: unknown): GameConfig {
  return GameConfigSchema.parse(fillMissing(payload, DEFAULT_GAME_CONFIG));
}
