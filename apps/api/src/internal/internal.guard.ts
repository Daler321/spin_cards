import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ErrorCode } from '@spincards/shared';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../common/app-error.js';
import { ENV, type Env } from '../config/env.js';

export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

/**
 * Internal bot routes (TZ 11.2): shared secret in a header, compared in constant time. The proxy
 * does not expose /internal at all; without a configured token the routes do not exist.
 */
@Injectable()
export class InternalGuard implements CanActivate {
  private readonly token: Buffer | null;

  constructor(@Inject(ENV) env: Env) {
    this.token = env.INTERNAL_API_TOKEN ? Buffer.from(env.INTERNAL_API_TOKEN) : null;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.token) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
    const header = context.switchToHttp().getRequest<FastifyRequest>().headers[
      INTERNAL_TOKEN_HEADER
    ];
    const given = Buffer.from(typeof header === 'string' ? header : '');
    if (given.length !== this.token.length || !timingSafeEqual(given, this.token))
      throw new AppError(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);
    return true;
  }
}
