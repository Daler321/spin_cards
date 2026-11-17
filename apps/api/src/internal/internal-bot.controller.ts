import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  BotChannelPostResponse,
  BotStartResponse,
  ClaimNotificationsResponse,
  PreCheckoutResponse,
  SubscriptionStatus,
  SuccessfulPaymentResponse,
  TextSettings,
} from '@spincards/shared';
import { NOTIFICATION_KINDS } from '@spincards/shared';
import { z } from 'zod';
import { EventsService } from '../analytics/events.service.js';
import { Public } from '../auth/decorators.js';
import { UsersService } from '../auth/users.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { BroadcastService } from '../notifications/broadcast.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { TextsService } from '../texts/texts.service.js';
import { SubscriptionService } from '../subscription/subscription.service.js';
import { InternalGuard } from './internal.guard.js';

const TelegramIdSchema = z.string().regex(/^\d{1,20}$/);

const StartSchema = z.object({
  user: z.object({
    telegramId: TelegramIdSchema,
    firstName: z.string().max(256),
    lastName: z.string().max(256).optional(),
    username: z.string().max(64).optional(),
    languageCode: z.string().max(35).optional(),
  }),
  payload: z.string().max(64).optional(),
});
const SettingsSchema = z.object({
  telegramId: TelegramIdSchema,
  notificationsEnabled: z.boolean(),
});
const ChatStatusSchema = z.object({ telegramId: TelegramIdSchema, blocked: z.boolean() });
const SubscriptionSchema = z.object({
  telegramId: TelegramIdSchema,
  fresh: z.boolean().optional(),
});
const ClaimSchema = z.object({
  limit: z.number().int().min(1).max(100),
  kinds: z.array(z.enum(NOTIFICATION_KINDS)).max(NOTIFICATION_KINDS.length).optional(),
});
const ResultSchema = z.object({
  outcome: z.enum(['sent', 'failed', 'blocked']),
  error: z.string().max(500).optional(),
  retryAfterSec: z.number().int().min(0).max(86_400).optional(),
});
const PreCheckoutSchema = z.object({
  telegramId: TelegramIdSchema,
  payload: z.string().max(128),
  currency: z.string().max(8),
  totalAmount: z.number().int().nonnegative(),
});
const ChannelPostSchema = z.object({
  chatId: z.string().regex(/^-?\d{1,20}$/),
  chatUsername: z
    .string()
    .regex(/^[A-Za-z0-9_]{4,32}$/)
    .optional(),
  messageId: z.number().int().positive(),
});
const PaymentSchema = PreCheckoutSchema.extend({
  telegramPaymentChargeId: z.string().min(1).max(256),
});

/** Routes only the bot calls (TZ 11.2). Never exposed by the proxy; guarded by the internal token. */
@Controller('internal/bot')
@Public()
@UseGuards(InternalGuard)
@RateLimit('internal')
export class InternalBotController {
  constructor(
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly payments: PaymentsService,
    private readonly events: EventsService,
    private readonly subscriptions: SubscriptionService,
    private readonly textsService: TextsService,
    private readonly broadcasts: BroadcastService,
  ) {}

  @Post('start')
  @HttpCode(HttpStatus.OK)
  async start(
    @Body(new ZodPipe(StartSchema)) body: z.infer<typeof StartSchema>,
  ): Promise<BotStartResponse> {
    const { user, isNew } = await this.users.startFromBot(
      {
        telegramId: BigInt(body.user.telegramId),
        firstName: body.user.firstName,
        lastName: body.user.lastName ?? null,
        username: body.user.username ?? null,
        languageCode: body.user.languageCode ?? null,
      },
      body.payload ?? null,
    );
    await this.events.track([{ userId: user.id, name: 'bot_start', props: { isNew } }]);
    return {
      isNew,
      notificationsEnabled: user.notificationsEnabled,
      referralCode: user.referralCode,
    };
  }

  @Post('settings')
  @HttpCode(HttpStatus.NO_CONTENT)
  async settings(
    @Body(new ZodPipe(SettingsSchema)) body: z.infer<typeof SettingsSchema>,
  ): Promise<void> {
    await this.prisma.user.updateMany({
      where: { telegramId: BigInt(body.telegramId) },
      data: { notificationsEnabled: body.notificationsEnabled },
    });
  }

  @Post('chat-status')
  @HttpCode(HttpStatus.NO_CONTENT)
  async chatStatus(
    @Body(new ZodPipe(ChatStatusSchema)) body: z.infer<typeof ChatStatusSchema>,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(body.telegramId) },
      select: { id: true },
    });
    if (!user) return;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { botBlockedAt: body.blocked ? new Date() : null },
    });
    await this.events.track([
      { userId: user.id, name: body.blocked ? 'bot_blocked' : 'bot_unblocked' },
    ]);
  }

  @Post('notifications/claim')
  @HttpCode(HttpStatus.OK)
  claim(
    @Body(new ZodPipe(ClaimSchema)) body: z.infer<typeof ClaimSchema>,
  ): Promise<ClaimNotificationsResponse> {
    return this.notifications.claim(body.limit, new Date(), body.kinds);
  }

  @Post('notifications/:id/result')
  @HttpCode(HttpStatus.NO_CONTENT)
  result(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ResultSchema)) body: z.infer<typeof ResultSchema>,
  ): Promise<void> {
    return this.notifications.report(id, body);
  }

  /** Owner-edited bot texts and the extra /start button (D-134); polled by the bot. */
  @Post('texts')
  @HttpCode(HttpStatus.OK)
  texts(): Promise<TextSettings> {
    return this.textsService.bot();
  }

  /**
   * D-145: a new post in a channel the bot administers. Only the channels listed in the subscription
   * settings count, and only while the owner turned channel posts on.
   */
  @Post('channel-post')
  @HttpCode(HttpStatus.OK)
  async channelPost(
    @Body(new ZodPipe(ChannelPostSchema)) body: z.infer<typeof ChannelPostSchema>,
  ): Promise<BotChannelPostResponse> {
    const [{ bot }, { channels }] = await Promise.all([
      this.textsService.settings(),
      this.subscriptions.settings(),
    ]);
    const handle = body.chatUsername ? `@${body.chatUsername.toLowerCase()}` : null;
    const listed = channels.some(
      (c) => c.chatId === body.chatId || (handle !== null && c.chatId.toLowerCase() === handle),
    );
    if (!bot.channelPosts || !listed) return { queued: 0 };
    return { queued: await this.broadcasts.channelPost(body.chatId, body.messageId) };
  }

  /** Required channels for /start and the "I subscribed" button (D-110). */
  @Post('subscription')
  @HttpCode(HttpStatus.OK)
  subscription(
    @Body(new ZodPipe(SubscriptionSchema)) body: z.infer<typeof SubscriptionSchema>,
  ): Promise<SubscriptionStatus> {
    return this.subscriptions.status(BigInt(body.telegramId), body.fresh ?? false);
  }

  @Post('payments/pre-checkout')
  @HttpCode(HttpStatus.OK)
  preCheckout(
    @Body(new ZodPipe(PreCheckoutSchema)) body: z.infer<typeof PreCheckoutSchema>,
  ): Promise<PreCheckoutResponse> {
    return this.payments.preCheckout(body);
  }

  @Post('payments/success')
  @HttpCode(HttpStatus.OK)
  success(
    @Body(new ZodPipe(PaymentSchema)) body: z.infer<typeof PaymentSchema>,
  ): Promise<SuccessfulPaymentResponse> {
    return this.payments.complete(body);
  }
}
