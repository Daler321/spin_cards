import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 24 * 3600_000;
/** Rows per DELETE: short statements, no long locks on busy tables. */
const BATCH = 5000;

/**
 * Daily cleanup of rows that only grow (D-118): replayed responses of idempotency keys after a
 * week (a client resends within minutes), refresh tokens a day after they expired (expired ones
 * can no longer be used or reused) and finished admin sessions. Ledger, spins and payments are
 * never touched.
 */
@Injectable()
export class HygieneService {
  private readonly logger = new Logger(HygieneService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(now = new Date()): Promise<Record<string, number>> {
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const removed = {
      idempotencyKeys: await this.batches(
        (limit) => this.prisma.$executeRaw`
          DELETE FROM idempotency_keys WHERE id IN (
            SELECT id FROM idempotency_keys WHERE created_at < ${weekAgo} LIMIT ${limit})`,
      ),
      refreshTokens: await this.batches(
        (limit) => this.prisma.$executeRaw`
          DELETE FROM refresh_tokens WHERE id IN (
            SELECT id FROM refresh_tokens WHERE expires_at < ${dayAgo} LIMIT ${limit})`,
      ),
      adminSessions: await this.batches(
        (limit) => this.prisma.$executeRaw`
          DELETE FROM admin_sessions WHERE id IN (
            SELECT id FROM admin_sessions
            WHERE expires_at < ${dayAgo} OR revoked_at < ${dayAgo} LIMIT ${limit})`,
      ),
    };
    this.logger.log({ removed }, 'hygiene done');
    return removed;
  }

  private async batches(remove: (limit: number) => Promise<number>): Promise<number> {
    let total = 0;
    for (;;) {
      const count = await remove(BATCH);
      total += count;
      if (count < BATCH) return total;
    }
  }
}
