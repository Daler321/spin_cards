import { Body, Controller, HttpCode, HttpStatus, Inject, Ip, Post } from '@nestjs/common';
import { ErrorCode } from '@spincards/shared';
import { z } from 'zod';
import { AntifraudService } from '../antifraud/antifraud.service.js';
import { AppError } from '../common/app-error.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ENV, type Env } from '../config/env.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { Public } from './decorators.js';
import { validateInitData } from './telegram-init-data.js';
import { TokensService } from './tokens.service.js';
import type { IssuedTokens } from '@spincards/shared';
import { profileFromTelegram, UsersService } from './users.service.js';

const TelegramLoginSchema = z.object({ initData: z.string().min(1).max(4096) });
const RefreshSchema = z.object({ refreshToken: z.string().min(16).max(256) });

@Public()
@RateLimit('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly users: UsersService,
    private readonly tokens: TokensService,
    private readonly antifraud: AntifraudService,
  ) {}

  /** Exchanges Telegram initData for tokens; creates the player on first login. */
  @Post('telegram')
  @HttpCode(HttpStatus.OK)
  async telegram(
    @Body(new ZodPipe(TelegramLoginSchema)) body: z.infer<typeof TelegramLoginSchema>,
    @Ip() ip: string,
  ): Promise<IssuedTokens> {
    const result = validateInitData(
      body.initData,
      this.env.TELEGRAM_BOT_TOKEN,
      this.env.INIT_DATA_MAX_AGE_SEC,
      new Date(),
    );
    if (!result.ok) {
      throw new AppError(
        result.reason === 'expired' ? ErrorCode.INIT_DATA_EXPIRED : ErrorCode.INVALID_INIT_DATA,
        HttpStatus.UNAUTHORIZED,
      );
    }
    const user = await this.users.signIn(
      profileFromTelegram(result.data.user),
      result.data.startParam,
    );
    await this.antifraud.recordLogin(user.id, ip);
    return this.tokens.issue(user.id);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body(new ZodPipe(RefreshSchema)) body: z.infer<typeof RefreshSchema>,
  ): Promise<IssuedTokens> {
    return this.tokens.rotate(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body(new ZodPipe(RefreshSchema)) body: z.infer<typeof RefreshSchema>,
  ): Promise<void> {
    await this.tokens.revoke(body.refreshToken);
  }
}
