import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';
import { type ApiErrorBody, ErrorCode, isErrorCode } from '@spincards/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { countServerError } from '../ops/watch.service.js';
import { REDIS } from '../redis/redis.module.js';
import { AppError } from './app-error.js';

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.MAINTENANCE,
};

/** Converts every error into `{ error: { code, requestId } }`; no messages or stack traces leak out. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  constructor(@Optional() @Inject(REDIS) private readonly redis?: Redis) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const code = codeFrom(exception) ?? STATUS_TO_CODE[status] ?? ErrorCode.INTERNAL_ERROR;

    // Domain errors are expected outcomes; only real failures are logged as errors.
    if (status >= 500 && !(exception instanceof AppError)) {
      this.logger.error(exception);
      // For the 5xx burst alert (D-117); counting must never fail the response.
      if (this.redis) void countServerError(this.redis).catch(() => undefined);
    }

    const body: ApiErrorBody = { error: { code, requestId: request.id } };
    void reply.status(status).send(body);
  }
}

function codeFrom(exception: unknown): ErrorCode | undefined {
  if (!(exception instanceof HttpException)) return undefined;
  const response = exception.getResponse();
  if (typeof response === 'object' && 'code' in response && isErrorCode(response.code)) {
    return response.code;
  }
  return undefined;
}
