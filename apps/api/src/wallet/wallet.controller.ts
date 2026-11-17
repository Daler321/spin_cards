import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { CURRENCIES, HISTORY_GROUPS, HISTORY_PERIODS, type HistoryGroup } from '@spincards/shared';
import { z } from 'zod';
import { CurrentUser, type RequestUser } from '../auth/decorators.js';
import { toApiMoney } from '../common/money.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { LedgerAccountType, type LedgerReason } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { ConversionService } from './conversion.service.js';
import { P2pService } from './p2p.service.js';
import type { ConvertResponse } from '@spincards/shared';
import type { HistoryItem, P2pRecipient, P2pSendResponse } from '@spincards/shared';

export const IdempotencyKeySchema = z.string().regex(/^[\w-]{8,128}$/);
const MAX_MONEY = 1_000_000_000_000; // 10 billion in major units: far above any game value

const ConvertSchema = z.object({
  from: z.enum(CURRENCIES),
  to: z.enum(CURRENCIES),
  amount: z.number().int().positive().max(MAX_MONEY),
  idempotencyKey: IdempotencyKeySchema,
});

const RecipientSchema = z.object({ username: z.string().trim().min(3).max(33) });
const SendSchema = z.object({
  username: z.string().trim().min(3).max(33),
  currency: z.enum(CURRENCIES),
  amount: z.number().int().positive().max(MAX_MONEY),
  idempotencyKey: IdempotencyKeySchema,
});

const HistorySchema = z.object({
  currency: z.enum(CURRENCIES).optional(),
  group: z.enum(Object.keys(HISTORY_GROUPS) as [HistoryGroup, ...HistoryGroup[]]).optional(),
  days: z.coerce
    .number()
    .refine((d) => (HISTORY_PERIODS as readonly number[]).includes(d))
    .optional(),
  cursor: z.coerce.bigint().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

@Controller('v1/wallet')
export class WalletController {
  constructor(
    private readonly conversions: ConversionService,
    private readonly prisma: PrismaService,
    private readonly p2p: P2pService,
  ) {}

  @Post('convert')
  @HttpCode(HttpStatus.OK)
  @RateLimit('mutation')
  convert(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(ConvertSchema)) body: z.infer<typeof ConvertSchema>,
  ): Promise<ConvertResponse> {
    return this.conversions.convert(user.id, body);
  }

  /** Wallet operations, newest first; pass `nextCursor` back as `cursor` for the next page. */
  /** D-131: the player behind a @username, to confirm before sending. */
  @Get('recipient')
  recipient(
    @CurrentUser() user: RequestUser,
    @Query(new ZodPipe(RecipientSchema)) query: z.infer<typeof RecipientSchema>,
  ): Promise<P2pRecipient> {
    return this.p2p.recipient(user.id, query.username);
  }

  /** D-131: money to another player by @username. */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  @RateLimit('mutation')
  send(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(SendSchema)) body: z.infer<typeof SendSchema>,
  ): Promise<P2pSendResponse> {
    return this.p2p.send(user.id, body);
  }

  @Get('history')
  async history(
    @CurrentUser() user: RequestUser,
    @Query(new ZodPipe(HistorySchema)) query: z.infer<typeof HistorySchema>,
  ): Promise<{ items: HistoryItem[]; nextCursor: string | null }> {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        userId: user.id,
        accountType: LedgerAccountType.wallet,
        ...(query.currency && { currency: query.currency }),
        ...(query.group && { reason: { in: [...HISTORY_GROUPS[query.group]] as LedgerReason[] } }),
        ...(query.days && { createdAt: { gte: new Date(Date.now() - query.days * 86_400_000) } }),
        ...(query.cursor && { id: { lt: query.cursor } }),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = entries.slice(0, query.limit);
    return {
      items: page.map((e) => ({
        id: e.id.toString(),
        currency: e.currency,
        delta: toApiMoney(e.delta),
        balanceAfter: toApiMoney(e.balanceAfter),
        reason: e.reason,
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor: entries.length > query.limit ? (page.at(-1)?.id.toString() ?? null) : null,
    };
  }
}
