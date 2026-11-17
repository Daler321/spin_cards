import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@spincards/shared';
import { AppError } from '../common/app-error.js';
import type { IdempotencyKey, Prisma } from '../generated/prisma/client.js';
import { isUniqueViolation, PrismaService, type Tx } from '../prisma/prisma.service.js';

export interface IdempotentRequest {
  userId: string;
  key: string;
  route: string;
  /** Request payload without the key itself; replays must match it exactly. */
  payload: unknown;
}

/**
 * Runs a mutation at most once per (user, idempotency key). The key row is inserted in the same
 * transaction as the mutation, so a concurrent duplicate blocks on the unique index until the first
 * commits and then replays its stored response. Failed mutations roll back their key and may be
 * retried with the same key.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T extends object>(
    request: IdempotentRequest,
    mutate: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    const requestHash = hashPayload(request.route, request.payload);
    const where = { userId_key: { userId: request.userId, key: request.key } };

    const stored = await this.prisma.idempotencyKey.findUnique({ where });
    if (stored) return replay(stored, request.route, requestHash) as T;

    try {
      return await this.prisma.transaction(async (tx) => {
        await tx.idempotencyKey.create({
          data: {
            userId: request.userId,
            key: request.key,
            route: request.route,
            requestHash,
            responseStatus: HttpStatus.OK,
            responseBody: {},
          },
        });
        const result = await mutate(tx);
        await tx.idempotencyKey.update({
          where,
          data: { responseBody: result as Prisma.InputJsonValue },
        });
        return result;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Either a concurrent duplicate committed first (replay it), or another unique constraint of
      // the mutation fired (e.g. a card number race): surface that to the caller.
      const winner = await this.prisma.idempotencyKey.findUnique({ where });
      if (!winner) throw error;
      return replay(winner, request.route, requestHash) as T;
    }
  }
}

function replay(stored: IdempotencyKey, route: string, requestHash: string): unknown {
  if (stored.route !== route || stored.requestHash !== requestHash) {
    throw new AppError(ErrorCode.IDEMPOTENCY_KEY_REUSED, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  return stored.responseBody;
}

export function hashPayload(route: string, payload: unknown): string {
  return createHash('sha256')
    .update(`${route}\n${stableStringify(payload)}`)
    .digest('hex');
}

/** JSON with sorted object keys, so equal payloads hash equally regardless of key order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
