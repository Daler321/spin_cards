import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@spincards/shared';

/** Domain error: the client receives only the code (see ErrorFilter). */
export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ code }, status);
  }
}
