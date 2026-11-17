import { Global, Module } from '@nestjs/common';
import { BroadcastService } from './broadcast.service.js';
import { NotificationScannerService } from './notification-scanner.service.js';
import { NotificationsService } from './notifications.service.js';

@Global()
@Module({
  providers: [NotificationsService, NotificationScannerService, BroadcastService],
  exports: [NotificationsService, NotificationScannerService, BroadcastService],
})
export class NotificationsModule {}
