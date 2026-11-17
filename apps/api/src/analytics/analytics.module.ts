import { Global, Module } from '@nestjs/common';
import { DailyStatsService } from './daily-stats.service.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';

@Global()
@Module({
  controllers: [EventsController],
  providers: [EventsService, DailyStatsService],
  exports: [EventsService, DailyStatsService],
})
export class AnalyticsModule {}
