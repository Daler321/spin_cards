import { Module } from '@nestjs/common';
import { GameModule } from '../game/game.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { TelegramApiService } from './telegram-api.service.js';

@Module({
  imports: [GameModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, TelegramApiService],
  exports: [PaymentsService, TelegramApiService],
})
export class PaymentsModule {}
