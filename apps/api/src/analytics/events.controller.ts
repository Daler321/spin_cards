import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CLIENT_EVENTS } from '@spincards/shared';
import { z } from 'zod';
import { SkipSubscription } from '../subscription/subscription.guard.js';
import { CurrentUser, type RequestUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { EventsService } from './events.service.js';

const ClientEventSchema = z.object({ name: z.enum(CLIENT_EVENTS) }).strict();

/** Events the Mini App reports itself (an allow-list; everything else is tracked server-side). */
@Controller('v1')
@SkipSubscription()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post('events')
  @HttpCode(HttpStatus.NO_CONTENT)
  async track(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(ClientEventSchema)) body: z.infer<typeof ClientEventSchema>,
  ): Promise<void> {
    await this.events.track([{ userId: user.id, name: body.name }]);
  }
}
