import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { ErrorCode, type ShareImageResponse, type SharePrepareResponse } from '@spincards/shared';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { CurrentUser, Public, type RequestUser } from '../auth/decorators.js';
import { AppError } from '../common/app-error.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { ShareService } from './share.service.js';

const UploadSchema = z.object({
  cardId: z.uuid(),
  image: z.string().min(100).max(900_000),
});
const PrepareSchema = z.object({
  token: z.string().regex(/^[\w-]{32}$/),
  text: z.string().trim().min(1).max(400),
  /** Only the game's own referral links are allowed under the text. */
  link: z
    .string()
    .regex(/^https:\/\/t\.me\/[A-Za-z0-9_]{3,64}\?startapp=ref_[A-Z2-9]{8}$/)
    .optional(),
  linkText: z.string().trim().min(1).max(80).optional(),
});
const TokenSchema = z.string().regex(/^[\w-]{32}\.jpg$/);

@Controller('v1/share')
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @Post('images')
  @HttpCode(HttpStatus.OK)
  @RateLimit('mutation')
  upload(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(UploadSchema)) body: z.infer<typeof UploadSchema>,
  ): Promise<ShareImageResponse> {
    return this.share.upload(user.id, body.cardId, body.image);
  }

  /** Public: Telegram and the save dialog fetch the image by its unguessable URL. */
  @Get('images/:file')
  @Public()
  async image(
    @Param('file', new ZodPipe(TokenSchema)) file: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const image = await this.share.image(file.slice(0, -4));
    if (!image) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
    await reply
      .header('content-type', 'image/jpeg')
      .header('cache-control', 'public, max-age=3600')
      .header('content-disposition', 'attachment; filename="spincards-card.jpg"')
      .send(image);
  }

  @Post('prepare')
  @HttpCode(HttpStatus.OK)
  @RateLimit('mutation')
  async prepare(
    @CurrentUser() user: RequestUser,
    @Body(new ZodPipe(PrepareSchema)) body: z.infer<typeof PrepareSchema>,
  ): Promise<SharePrepareResponse> {
    return {
      preparedMessageId: await this.share.prepare(user.id, body.token, {
        text: body.text,
        ...(body.link && body.linkText && { link: { url: body.link, text: body.linkText } }),
      }),
    };
  }
}
