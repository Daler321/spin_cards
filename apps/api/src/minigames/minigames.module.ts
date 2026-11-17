import { Module } from '@nestjs/common';
import { MiniGamesController } from './minigames.controller.js';
import { MiniGamesService } from './minigames.service.js';

@Module({ controllers: [MiniGamesController], providers: [MiniGamesService] })
export class MiniGamesModule {}
