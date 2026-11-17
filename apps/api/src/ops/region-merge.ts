import { Injectable } from '@nestjs/common';
import { type Currency, DEFAULT_REGION } from '@spincards/shared';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { LedgerAccountType, LedgerReason } from '../generated/prisma/client.js';
import { lockPlayer } from '../game/player-lock.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface RegionMergeReport {
  players: number;
  moved: number;
  /** Got the season start money in the default currency now. */
  credited: number;
}

/**
 * D-156: everybody starts in rubles. A one-off fix for players whose season started in another
 * region (and got no start money there): they move to the default region, and who has not had the
 * running season's start money in rubles yet (sign-up or season start) gets it through the ledger.
 * Money in other currencies stays where it is; switching back to dollars is still allowed. Every
 * move is in `audit_log`. Safe to run again.
 */
@Injectable()
export class RegionMergeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
    private readonly ledger: LedgerService,
  ) {}

  async run(options: {
    reason: string;
    confirm: boolean;
    /** Only these players (default: everybody). */
    userIds?: string[];
  }): Promise<RegionMergeReport> {
    const users = await this.prisma.user.findMany({
      where: {
        region: { not: DEFAULT_REGION },
        ...(options.userIds && { id: { in: options.userIds } }),
      },
      select: { id: true },
    });
    const report: RegionMergeReport = { players: users.length, moved: 0, credited: 0 };
    if (!options.confirm) return report;

    const { config } = await this.config.active();
    const currency: Currency = config.regions[DEFAULT_REGION].currency;
    const start = BigInt(config.startingBalance[currency] ?? 0);
    const seasonId = await this.seasons.currentSeasonId();
    for (const { id } of users) {
      const credited = await this.prisma.transaction(async (tx) => {
        await lockPlayer(tx, id);
        const user = await tx.user.findUniqueOrThrow({ where: { id } });
        if (user.region === DEFAULT_REGION) return null;
        await tx.user.update({ where: { id }, data: { region: DEFAULT_REGION } });
        const had = await tx.ledgerEntry.findFirst({
          where: {
            userId: id,
            seasonId,
            currency,
            reason: { in: [LedgerReason.season_start, LedgerReason.signup_bonus] },
          },
          select: { id: true },
        });
        const wallet = await tx.wallet.findUnique({
          where: { userId_currency: { userId: id, currency } },
        });
        const credit = !had && wallet !== null && start > 0n;
        if (credit)
          await this.ledger.post(
            tx,
            [
              {
                account: { type: LedgerAccountType.wallet, id: wallet.id },
                delta: start,
                reason: LedgerReason.season_start,
                ref: { type: 'season', id: seasonId },
              },
            ],
            { seasonId },
          );
        await tx.auditLog.create({
          data: {
            actorType: 'system',
            actorId: 'region-merge',
            action: 'user.region_merge',
            targetType: 'user',
            targetId: id,
            reason: options.reason,
            payload: {
              from: user.region,
              to: DEFAULT_REGION,
              startMoney: credit ? Number(start) : 0,
            },
          },
        });
        return credit;
      });
      if (credited === null) continue;
      report.moved++;
      if (credited) report.credited++;
    }
    return report;
  }
}
