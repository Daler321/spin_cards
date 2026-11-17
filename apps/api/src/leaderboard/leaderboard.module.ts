import { Global, Module } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service.js';

@Global()
@Module({ providers: [LeaderboardService], exports: [LeaderboardService] })
export class LeaderboardModule {}
