import { Module } from '@nestjs/common';
import { P2pService } from './p2p.service.js';
import { ConversionService } from './conversion.service.js';
import { ExchangeRateService } from './exchange-rate.service.js';
import { WalletController } from './wallet.controller.js';

@Module({
  controllers: [WalletController],
  providers: [ConversionService, ExchangeRateService, P2pService],
  exports: [ExchangeRateService],
})
export class WalletModule {}
