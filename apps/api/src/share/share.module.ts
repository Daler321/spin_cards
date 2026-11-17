import { Global, Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { ShareController } from './share.controller.js';
import { ShareService } from './share.service.js';

@Global()
@Module({
  imports: [PaymentsModule],
  controllers: [ShareController],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}
