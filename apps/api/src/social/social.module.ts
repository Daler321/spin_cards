import { Module } from '@nestjs/common';
import { GameModule } from '../game/game.module.js';
import { SocialController } from './social.controller.js';
import { AlbumService } from './album.service.js';
import { SocialService } from './social.service.js';

@Module({
  imports: [GameModule],
  controllers: [SocialController],
  providers: [SocialService, AlbumService],
})
export class SocialModule {}
