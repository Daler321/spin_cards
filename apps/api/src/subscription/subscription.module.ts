import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PaymentsModule } from '../payments/payments.module.js';
import { SubscriptionController } from './subscription.controller.js';
import { SubscriptionGuard } from './subscription.guard.js';
import { SubscriptionService } from './subscription.service.js';

@Global()
@Module({
  imports: [PaymentsModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, { provide: APP_GUARD, useClass: SubscriptionGuard }],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
