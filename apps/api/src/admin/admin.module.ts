import { Module } from '@nestjs/common';
import { GameModule } from '../game/game.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAccountsService } from './admin-accounts.service.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminConfigService } from './admin-config.service.js';
import { AdminEconomyController } from './admin-economy.controller.js';
import { AdminController } from './admin.controller.js';
import { AdminGuard } from './admin.guard.js';
import { AdminOpsService } from './admin-ops.service.js';
import { AdminUsersService } from './admin-users.service.js';

@Module({
  imports: [GameModule, PaymentsModule],
  controllers: [AdminAuthController, AdminController, AdminEconomyController],
  providers: [
    AdminAuthService,
    AdminGuard,
    AdminUsersService,
    AdminOpsService,
    AdminConfigService,
    AdminAccountsService,
  ],
})
export class AdminModule {}
