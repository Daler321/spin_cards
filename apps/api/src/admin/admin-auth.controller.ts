import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { AdminLoginResponse, AdminMe } from '@spincards/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { type AdminSessionIssued, AdminAuthService } from './admin-auth.service.js';
import { ADMIN_COOKIE, AdminGuard, AdminRoles, CurrentAdmin, readCookie } from './admin.guard.js';

const LoginSchema = z.object({
  login: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
const SetupSchema = z.object({
  setupToken: z.string().min(16).max(128),
  code: z.string().regex(/^\d{6}$/),
});

function setSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  session: AdminSessionIssued,
) {
  const secure = request.protocol === 'https' ? '; Secure' : '';
  void reply.header(
    'set-cookie',
    `${ADMIN_COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${String(session.maxAgeSec)}${secure}`,
  );
}

@Controller('admin/auth')
@Public()
@RateLimit('auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodPipe(LoginSchema)) body: z.infer<typeof LoginSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminLoginResponse> {
    const { response, session } = await this.auth.login(body.login, body.password, body.totp);
    if (session) setSessionCookie(request, reply, session);
    return response;
  }

  @Post('totp/setup')
  @HttpCode(HttpStatus.OK)
  async setup(
    @Body(new ZodPipe(SetupSchema)) body: z.infer<typeof SetupSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminLoginResponse> {
    const { response, session } = await this.auth.setupTotp(body.setupToken, body.code);
    setSessionCookie(request, reply, session);
    return response;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const token = readCookie(request, ADMIN_COOKIE);
    if (token) await this.auth.logout(token);
    void reply.header(
      'set-cookie',
      `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
    );
  }

  @Get('me')
  @UseGuards(AdminGuard)
  @AdminRoles('analyst', 'support')
  me(@CurrentAdmin() admin: AdminMe): AdminMe {
    return admin;
  }
}
