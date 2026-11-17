import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@spincards/shared';
import { type AuthedRequest, IS_PUBLIC } from '../auth/decorators.js';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SubscriptionService } from './subscription.service.js';

const SKIP = 'skipSubscription';
/** Player routes that work before subscribing (profile, config, the subscription itself). */
export const SkipSubscription = () => SetMetadata(SKIP, true);

/** Global: player routes need the required channel subscriptions (D-110). */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptions: SubscriptionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP, targets)) return true;
    const settings = await this.subscriptions.settings();
    if (!settings.enabled || settings.channels.length === 0) return true;
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) return true;
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { telegramId: true },
    });
    if (!row) return true;
    const status = await this.subscriptions.status(row.telegramId);
    if (!status.ok) throw new AppError(ErrorCode.SUBSCRIPTION_REQUIRED, HttpStatus.FORBIDDEN);
    return true;
  }
}
