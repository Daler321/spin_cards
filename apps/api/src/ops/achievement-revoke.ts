import { Injectable } from '@nestjs/common';
import { SeasonService } from '../game-config/season.service.js';
import { LedgerAccountType, LedgerReason } from '../generated/prisma/client.js';
import { lockPlayer } from '../game/player-lock.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface RevokeItem {
  achievementId: string;
  /** Reward money paid since `since` and taken back now (minor units). */
  refund: number;
  /** Medal row found (and removed with --confirm). */
  medal: boolean;
  /** Already taken back by an earlier run. */
  done: boolean;
}

/**
 * D-151: takes back medals granted by mistake (from a previous season's spins) together with the
 * money they paid since `since`: a compensating ledger entry on the same wallet, the medal row
 * removed, an audit_log record. Safe to run again: a revoked medal is skipped.
 */
@Injectable()
export class AchievementRevokeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly seasons: SeasonService,
  ) {}

  async run(options: {
    username: string;
    achievementIds: string[];
    since: Date;
    reason: string;
    confirm: boolean;
  }): Promise<{ userId: string; items: RevokeItem[] }> {
    const user = await this.prisma.user.findFirstOrThrow({
      where: { username: { equals: options.username, mode: 'insensitive' } },
    });
    const seasonId = await this.seasons.currentSeasonId();
    const items: RevokeItem[] = [];
    for (const achievementId of options.achievementIds) {
      const item = await this.prisma.transaction(async (tx) => {
        await lockPlayer(tx, user.id);
        const refId = `${achievementId}:${user.id}`;
        const done = await tx.ledgerEntry.findFirst({
          where: { reason: LedgerReason.admin_adjust, refType: 'achievement_revoke', refId },
          select: { id: true },
        });
        const paid = await tx.ledgerEntry.findMany({
          where: {
            reason: LedgerReason.achievement,
            refId,
            createdAt: { gte: options.since },
            delta: { gt: 0n },
          },
        });
        const medal = await tx.userAchievement.findFirst({
          where: { userId: user.id, achievementId },
        });
        const refund = paid.reduce((sum, e) => sum + Number(e.delta), 0);
        const result = { achievementId, refund, medal: medal !== null, done: done !== null };
        if (!options.confirm || done || (!medal && refund === 0)) return result;
        // Every credited wallet gives its part back (normally one, the region's currency).
        const postings = paid.map((e) => ({
          account: { type: LedgerAccountType.wallet, id: e.accountId },
          delta: -e.delta,
          reason: LedgerReason.admin_adjust,
          ref: { type: 'achievement_revoke', id: refId },
        }));
        if (postings.length > 0) await this.ledger.post(tx, postings, { seasonId });
        if (medal) await tx.userAchievement.delete({ where: { id: medal.id } });
        await tx.auditLog.create({
          data: {
            actorType: 'system',
            actorId: 'achievement-revoke',
            action: 'achievement.revoke',
            targetType: 'user',
            targetId: user.id,
            reason: options.reason,
            payload: { achievementId, refund },
          },
        });
        return result;
      });
      items.push(item);
    }
    return { userId: user.id, items };
  }
}
