import { Module } from '@nestjs/common';
import { AchievementsService } from './achievements.service.js';
import { BonusService } from './bonus.service.js';
import { CardsService } from './cards.service.js';
import { CraftService } from './craft.service.js';
import { IncomeService } from './income.service.js';
import { GameController } from './game.controller.js';
import { QuestsController } from './quests.controller.js';
import { QuestsService } from './quests.service.js';
import { LifecycleService } from './lifecycle.service.js';
import { ReferralCommissionService, ReferralService } from './referral.service.js';
import { ShopService } from './shop.service.js';
import { SpinService } from './spin.service.js';

@Module({
  controllers: [GameController, QuestsController],
  providers: [
    SpinService,
    CardsService,
    CraftService,
    IncomeService,
    ShopService,
    LifecycleService,
    BonusService,
    ReferralService,
    ReferralCommissionService,
    QuestsService,
    AchievementsService,
  ],
  exports: [
    QuestsService,
    AchievementsService,
    CardsService,
    LifecycleService,
    ReferralService,
    ReferralCommissionService,
  ],
})
export class GameModule {}
