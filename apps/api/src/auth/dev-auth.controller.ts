import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { Public } from './decorators.js';
import { TokensService } from './tokens.service.js';
import type { IssuedTokens } from '@spincards/shared';
import { UsersService } from './users.service.js';

const DevLoginSchema = z.object({
  telegramId: z.number().int().positive().default(1),
  firstName: z.string().min(1).max(64).default('Dev'),
  startParam: z.string().max(64).nullable().default(null),
});

/**
 * Mock login without a Telegram signature for browser debugging. Registered only when
 * NODE_ENV=development and DEV_AUTH_BYPASS=true (see AuthModule).
 */
@Public()
@RateLimit('auth')
@Controller('v1/auth')
export class DevAuthController {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokensService,
  ) {}

  @Post('dev')
  @HttpCode(HttpStatus.OK)
  async dev(
    @Body(new ZodPipe(DevLoginSchema)) body: z.infer<typeof DevLoginSchema>,
  ): Promise<IssuedTokens> {
    const user = await this.users.signIn(
      {
        telegramId: BigInt(body.telegramId),
        firstName: body.firstName,
        lastName: null,
        username: null,
        languageCode: 'ru',
        photoUrl: null,
      },
      body.startParam,
    );
    return this.tokens.issue(user.id);
  }
}
