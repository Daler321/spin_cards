import { Global, Module } from '@nestjs/common';
import { SafeguardsService } from './safeguards.service.js';

@Global()
@Module({ providers: [SafeguardsService], exports: [SafeguardsService] })
export class SafeguardsModule {}
