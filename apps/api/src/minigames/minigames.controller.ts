import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CURRENCIES, MINIGAME_DIFFICULTIES } from '@spincards/shared';
import { z } from 'zod';
import { CurrentUser, type RequestUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { IdempotencyKeySchema } from '../wallet/wallet.controller.js';
import { MiniGamesService } from './minigames.service.js';

const amount = z.number().int().positive().max(1_000_000_000_000);
const BetSchema = z.object({
  currency: z.enum(CURRENCIES),
  bet: amount,
  idempotencyKey: IdempotencyKeySchema,
});
const RoundSchema = z.object({ roundId: z.uuid(), idempotencyKey: IdempotencyKeySchema });
const MinesStartSchema = BetSchema.extend({
  difficulty: z.enum(MINIGAME_DIFFICULTIES),
  mines: z.number().int().positive().max(64),
});
const MinesOpenSchema = RoundSchema.extend({ cell: z.number().int().nonnegative().max(63) });
const PlinkoSchema = z.object({
  currency: z.enum(CURRENCIES),
  betPerBall: amount,
  balls: z.number().int().min(1).max(30),
  difficulty: z.enum(MINIGAME_DIFFICULTIES),
  idempotencyKey: IdempotencyKeySchema,
});
const CoinflipSchema = BetSchema.extend({ side: z.enum(['heads', 'tails']) });
const BlackjackActSchema = RoundSchema.extend({ action: z.enum(['hit', 'stand', 'double']) });

/** D-169: every result is decided on the server before the client animates it. */
@Controller('v1/minigames')
@RateLimit('mutation')
export class MiniGamesController {
  constructor(private readonly games: MiniGamesService) {}

  @Get()
  @RateLimit('default')
  info(@CurrentUser() user: RequestUser) {
    return this.games.info(user.id);
  }

  @Post('mines/start')
  @HttpCode(HttpStatus.OK)
  minesStart(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(MinesStartSchema)) body: z.infer<typeof MinesStartSchema>,
  ) {
    return this.games.minesStart(user.id, body);
  }

  @Post('mines/open')
  @HttpCode(HttpStatus.OK)
  minesOpen(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(MinesOpenSchema)) body: z.infer<typeof MinesOpenSchema>,
  ) {
    return this.games.minesOpen(user.id, body);
  }

  @Post('mines/cashout')
  @HttpCode(HttpStatus.OK)
  minesCashout(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(RoundSchema)) body: z.infer<typeof RoundSchema>,
  ) {
    return this.games.minesCashout(user.id, body);
  }

  @Post('plinko')
  @HttpCode(HttpStatus.OK)
  plinko(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(PlinkoSchema)) body: z.infer<typeof PlinkoSchema>,
  ) {
    return this.games.plinko(user.id, body);
  }

  @Post('coinflip')
  @HttpCode(HttpStatus.OK)
  coinflip(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(CoinflipSchema)) body: z.infer<typeof CoinflipSchema>,
  ) {
    return this.games.coinflip(user.id, body);
  }

  @Post('blackjack/start')
  @HttpCode(HttpStatus.OK)
  blackjackStart(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(BetSchema)) body: z.infer<typeof BetSchema>,
  ) {
    return this.games.blackjackStart(user.id, body);
  }

  @Post('blackjack/act')
  @HttpCode(HttpStatus.OK)
  blackjackAct(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(BlackjackActSchema)) body: z.infer<typeof BlackjackActSchema>,
  ) {
    return this.games.blackjackAct(user.id, body);
  }
}
