import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { ErrorCode } from '@spincards/shared';
import type { z } from 'zod';
import { AppError } from './app-error.js';

/** Validates and parses request input; failures become VALIDATION_FAILED without details. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) throw new AppError(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    return result.data;
  }
}
