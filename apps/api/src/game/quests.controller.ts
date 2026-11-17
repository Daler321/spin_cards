import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type {
  ChannelQuestClaimResponse,
  QuestClaimResponse,
  QuestsResponse,
} from '@spincards/shared';
import { z } from 'zod';
import { CurrentUser, type RequestUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { IdempotencyKeySchema } from '../wallet/wallet.controller.js';
import { QuestsService } from './quests.service.js';

const KeySchema = z.object({ idempotencyKey: IdempotencyKeySchema });
const InviteClaimSchema = KeySchema.extend({ friends: z.number().int().positive() });

/** Daily and season quests (D-124). */
@Controller('v1/quests')
@RateLimit('mutation')
export class QuestsController {
  constructor(private readonly quests: QuestsService) {}

  @Get()
  @RateLimit('default')
  list(@CurrentUser() user: RequestUser): Promise<QuestsResponse> {
    return this.quests.list(user.id);
  }

  /** D-157: the reward for joining the channel; Telegram is asked at this moment. */
  @Post('channel/claim')
  @HttpCode(HttpStatus.OK)
  claimChannel(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(KeySchema)) body: z.infer<typeof KeySchema>,
  ): Promise<ChannelQuestClaimResponse> {
    return this.quests.claimChannel(user.id, body.idempotencyKey);
  }

  /** D-158: the reward of one step of the invite quest. */
  @Post('invite/claim')
  @HttpCode(HttpStatus.OK)
  claimInvite(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(InviteClaimSchema)) body: z.infer<typeof InviteClaimSchema>,
  ): Promise<ChannelQuestClaimResponse> {
    return this.quests.claimInvite(user.id, body.friends, body.idempotencyKey);
  }

  @Post(':id/claim')
  @HttpCode(HttpStatus.OK)
  claim(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(KeySchema)) body: z.infer<typeof KeySchema>,
  ): Promise<QuestClaimResponse> {
    return this.quests.claim(user.id, id, body.idempotencyKey);
  }
}
