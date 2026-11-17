import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@spincards/shared';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type AuthedRequest, IS_PUBLIC } from './decorators.js';
import { TokensService } from './tokens.service.js';

/** Global guard: every route needs a valid access token unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    const userId = scheme === 'Bearer' && token ? await this.tokens.verifyAccess(token) : null;
    if (!userId) throw new AppError(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isBanned: true },
    });
    if (!user) throw new AppError(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);
    if (user.isBanned) throw new AppError(ErrorCode.USER_BANNED, HttpStatus.FORBIDDEN);

    request.user = { id: user.id };
    return true;
  }
}
