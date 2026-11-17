import { Global, Module } from '@nestjs/common';
import { FlagsService } from './flags.service.js';
import { GameConfigService } from './game-config.service.js';
import { SeasonService } from './season.service.js';

@Global()
@Module({
  providers: [GameConfigService, SeasonService, FlagsService],
  exports: [GameConfigService, SeasonService, FlagsService],
})
export class GameConfigModule {}
