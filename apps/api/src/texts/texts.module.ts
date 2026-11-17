import { Global, Module } from '@nestjs/common';
import { TextsService } from './texts.service.js';

@Global()
@Module({ providers: [TextsService], exports: [TextsService] })
export class TextsModule {}
