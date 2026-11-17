import { Injectable, Logger } from '@nestjs/common';
import { GameConfigService } from '../game-config/game-config.service.js';
import { SeasonService } from '../game-config/season.service.js';
import { CardStatus, LedgerAccountType, LedgerReason } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const BURN_BATCH = 200;

/**
 * Card lifetime job (TZ 6), run every minute by the worker:
 * active past expires_at -> expired with a grace window; expired past grace_until -> the balance
 * burns through the ledger and the card returns to the pool without an owner.
 */
@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly seasons: SeasonService,
  ) {}

  async run(now: Date = new Date()): Promise<{ expired: number; burned: number }> {
    const { config } = await this.config.active();
    const expired = await this.prisma.$executeRaw`
      UPDATE cards SET status = 'expired',
        grace_until = expires_at + make_interval(hours => ${config.lifecycle.graceHours}::int),
        updated_at = now()
      WHERE status = 'active' AND expires_at <= ${now}`;

    let burned = 0;
    for (;;) {
      const count = await this.burnBatch(now);
      burned += count;
      if (count < BURN_BATCH) break;
    }
    if (expired > 0 || burned > 0) this.logger.log({ expired, burned }, 'card lifecycle');
    return { expired, burned };
  }

  private async burnBatch(now: Date): Promise<number> {
    const seasonId = await this.seasons.currentSeasonId();
    return this.prisma.transaction(async (tx) => {
      // SKIP LOCKED: cards a player is acting on right now are picked up on the next run.
      const due = await tx.$queryRaw<{ id: string; balance: bigint }[]>`
        SELECT id::text, balance FROM cards
        WHERE status = 'expired' AND grace_until <= ${now}
        ORDER BY grace_until LIMIT ${BURN_BATCH} FOR UPDATE SKIP LOCKED`;
      for (const card of due) {
        await this.ledger.post(
          tx,
          [
            {
              account: { type: LedgerAccountType.card, id: card.id },
              delta: -card.balance,
              reason: LedgerReason.card_burn,
              ref: { type: 'card', id: card.id },
            },
          ],
          { seasonId },
        );
        await tx.card.update({
          where: { id: card.id },
          data: {
            status: CardStatus.pooled,
            ownerId: null,
            heldAt: null,
            graceUntil: null,
            pooledAt: now,
          },
        });
      }
      return due.length;
    });
  }
}
