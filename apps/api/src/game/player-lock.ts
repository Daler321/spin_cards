import type { Tx } from '../prisma/prisma.service.js';

/**
 * Every player mutation (spin, card actions, purchases, bonuses) starts by locking the user row, so
 * one player's actions run one at a time and always take further locks in the same order.
 */
export async function lockPlayer(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
}
