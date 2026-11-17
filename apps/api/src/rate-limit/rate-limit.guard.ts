import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@spincards/shared';
import type { Redis } from 'ioredis';
import type { AuthedRequest } from '../auth/decorators.js';
import { TokensService } from '../auth/tokens.service.js';
import { AppError } from '../common/app-error.js';
import { ENV, type Env } from '../config/env.js';
import { REDIS } from '../redis/redis.module.js';

export type RateLimitBucket = 'default' | 'auth' | 'mutation' | 'internal';

const RATE_LIMIT = 'rateLimit';
const WINDOW_SEC = 60;

/** Selects the per-minute budget of a controller or route (default: RATE_LIMIT_DEFAULT_PER_MIN). */
export const RateLimit = (bucket: RateLimitBucket) => SetMetadata(RATE_LIMIT, bucket);

/**
 * Fixed-window limiter in Redis, keyed by user (valid access token) or client IP. If Redis is
 * unavailable requests pass: availability wins over throttling, and the outage is logged.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly limits: Record<RateLimitBucket, number>;

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) env: Env,
  ) {
    this.limits = {
      default: env.RATE_LIMIT_DEFAULT_PER_MIN,
      auth: env.RATE_LIMIT_AUTH_PER_MIN,
      mutation: env.RATE_LIMIT_MUTATION_PER_MIN,
      internal: env.RATE_LIMIT_INTERNAL_PER_MIN,
    };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const bucket =
      this.reflector.getAllAndOverride<RateLimitBucket | undefined>(RATE_LIMIT, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'default';
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const identity = await this.identify(request);
    const key = `rl:${bucket}:${identity}:${Math.floor(Date.now() / (WINDOW_SEC * 1000))}`;

    let count: number;
    try {
      count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, WINDOW_SEC);
    } catch (error) {
      this.logger.warn({ err: error }, 'rate limiter unavailable');
      return true;
    }
    if (count > this.limits[bucket])
      throw new AppError(ErrorCode.RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }

  private async identify(request: AuthedRequest): Promise<string> {
    if (request.user) return `u:${request.user.id}`;
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    const userId = scheme === 'Bearer' && token ? await this.tokens.verifyAccess(token) : null;
    return userId ? `u:${userId}` : `ip:${request.ip}`;
  }
}
