import { Global, Module } from '@nestjs/common';
import { TelegramApiService } from '../payments/telegram-api.service.js';
import { OpsAlertsService } from './alerts.service.js';
import { BackupService } from './backup.service.js';
import { HygieneService } from './hygiene.service.js';
import { AchievementRevokeService } from './achievement-revoke.js';
import { RegionMergeService } from './region-merge.js';
import { SeasonLaunchService } from './season-launch.js';
import { OpsWatchService } from './watch.service.js';

/** Alerts, backups and watching (D-117); shared by the api (admin panel) and the worker (jobs). */
@Global()
@Module({
  providers: [
    TelegramApiService,
    OpsAlertsService,
    BackupService,
    OpsWatchService,
    HygieneService,
    SeasonLaunchService,
    AchievementRevokeService,
    RegionMergeService,
  ],
  exports: [OpsAlertsService, BackupService, OpsWatchService, HygieneService],
})
export class OpsModule {}
