import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ErrorFilter } from './common/error.filter.js';
import { pinoParams } from './common/logger.js';
import { ENV, type Env } from './config/env.js';
import { GameModule } from './game/game.module.js';
import { GameConfigModule } from './game-config/game-config.module.js';
import { HealthModule } from './health/health.module.js';
import { IdempotencyModule } from './idempotency/idempotency.module.js';
import { LeaderboardModule } from './leaderboard/leaderboard.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { InternalModule } from './internal/internal.module.js';
import { MeModule } from './me/me.module.js';
import { MiniGamesModule } from './minigames/minigames.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { RedisModule } from './redis/redis.module.js';
import { AntifraudModule } from './antifraud/antifraud.module.js';
import { TextsModule } from './texts/texts.module.js';
import { OpsModule } from './ops/ops.module.js';
import { SafeguardsModule } from './safeguards/safeguards.module.js';
import { ShareModule } from './share/share.module.js';
import { SocialModule } from './social/social.module.js';
import { SubscriptionModule } from './subscription/subscription.module.js';
import { WalletModule } from './wallet/wallet.module.js';

@Global()
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    const auth = AuthModule.forRoot(env);
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot(pinoParams(env)),
        PrismaModule,
        RedisModule,
        GameConfigModule,
        LedgerModule,
        IdempotencyModule,
        AnalyticsModule,
        LeaderboardModule,
        auth,
        RateLimitModule,
        HealthModule,
        MeModule,
        WalletModule,
        GameModule,
        MiniGamesModule,
        SocialModule,
        NotificationsModule,
        PaymentsModule,
        InternalModule,
        SafeguardsModule,
        OpsModule,
        AntifraudModule,
        TextsModule,
        SubscriptionModule,
        ShareModule,
        AdminModule,
      ],
      providers: [
        { provide: ENV, useValue: env },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
      exports: [ENV, auth],
    };
  }
}
