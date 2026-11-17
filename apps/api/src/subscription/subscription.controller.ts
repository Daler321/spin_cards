import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { SubscriptionStatus } from '@spincards/shared';
import { CurrentUser, type RequestUser } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SkipSubscription } from './subscription.guard.js';
import { SubscriptionService } from './subscription.service.js';

@Controller('v1/subscription')
@SkipSubscription()
export class SubscriptionController {
  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async status(@CurrentUser() user: RequestUser): Promise<SubscriptionStatus> {
    return this.subscriptions.status(await this.telegramId(user.id));
  }

  /** "I subscribed": asks Telegram again instead of the cached answer. */
  @Post('check')
  @HttpCode(HttpStatus.OK)
  async check(@CurrentUser() user: RequestUser): Promise<SubscriptionStatus> {
    return this.subscriptions.status(await this.telegramId(user.id), true);
  }

  private async telegramId(userId: string): Promise<bigint> {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { telegramId: true },
    });
    return row.telegramId;
  }
}
