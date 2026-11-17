import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Env } from '../config/env.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { DevAuthController } from './dev-auth.controller.js';
import { TokensService } from './tokens.service.js';
import { UsersService } from './users.service.js';

@Module({})
export class AuthModule {
  static forRoot(env: Env): DynamicModule {
    const devBypass = env.NODE_ENV === 'development' && env.DEV_AUTH_BYPASS;
    return {
      module: AuthModule,
      controllers: devBypass ? [AuthController, DevAuthController] : [AuthController],
      providers: [TokensService, UsersService, { provide: APP_GUARD, useClass: AuthGuard }],
      exports: [TokensService, UsersService],
    };
  }
}
