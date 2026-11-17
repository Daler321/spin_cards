import { Module } from '@nestjs/common';
import { GameModule } from '../game/game.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { MeController } from './me.controller.js';
import { PublicConfigController } from './public-config.controller.js';

@Module({
  imports: [PaymentsModule, GameModule],
  controllers: [MeController, PublicConfigController],
})
export class MeModule {}
