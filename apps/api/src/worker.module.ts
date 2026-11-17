import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ENV, type Env } from './config/env.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { GameConfigModule } from './game-config/game-config.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { LifecycleService } from './game/lifecycle.service.js';
import { ReferralCommissionService } from './game/referral.service.js';
import { SeasonRolloverService } from './game/season-rollover.service.js';
import { AchievementsService } from './game/achievements.service.js';
import { NickCheckService } from './game/nick-check.service.js';
import { TelegramApiService } from './payments/telegram-api.service.js';
import { LeaderboardModule } from './leaderboard/leaderboard.module.js';
import { RedisModule } from './redis/redis.module.js';
import { OpsModule } from './ops/ops.module.js';
import { SafeguardsModule } from './safeguards/safeguards.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

/** Background jobs: no HTTP, only what the processors need. */
@Global()
@Module({})
export class WorkerModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        PrismaModule,
        GameConfigModule,
        LedgerModule,
        AnalyticsModule,
        NotificationsModule,
        RedisModule,
        LeaderboardModule,
        SafeguardsModule,
        OpsModule,
      ],
      providers: [
        { provide: ENV, useValue: env },
        LifecycleService,
        ReferralCommissionService,
        SeasonRolloverService,
        AchievementsService,
        TelegramApiService,
        NickCheckService,
      ],
      exports: [ENV],
    };
  }
}
