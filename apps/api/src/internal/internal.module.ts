import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { InternalBotController } from './internal-bot.controller.js';
import { InternalGuard } from './internal.guard.js';

@Module({
  imports: [PaymentsModule],
  controllers: [InternalBotController],
  providers: [InternalGuard],
})
export class InternalModule {}
