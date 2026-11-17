import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { StarsInvoiceResponse } from '@spincards/shared';
import { z } from 'zod';
import { CurrentUser, type RequestUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { IdempotencyKeySchema } from '../wallet/wallet.controller.js';
import { PaymentsService } from './payments.service.js';

const InvoiceSchema = z.object({
  productId: z.string().min(1).max(64),
  /** D-146: the card a card product is for. */
  cardId: z.uuid().optional(),
  idempotencyKey: IdempotencyKeySchema,
});

@Controller('v1/payments')
@RateLimit('mutation')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Behind `stars_enabled` (TZ 9): returns PAYMENTS_DISABLED while the flag is off. */
  @Post('stars/invoice')
  @HttpCode(HttpStatus.OK)
  invoice(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(InvoiceSchema)) body: z.infer<typeof InvoiceSchema>,
  ): Promise<StarsInvoiceResponse> {
    return this.payments.createInvoice(user.id, body.productId, body.idempotencyKey, body.cardId);
  }
}
