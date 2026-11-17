import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AdminMe, type AdminRole, ErrorCode } from '@spincards/shared';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../common/app-error.js';
import { AdminAuthService } from './admin-auth.service.js';

export const ADMIN_COOKIE = 'sc_admin';
/** Mutations must carry this header: a cross-site form cannot set it (CSRF guard with SameSite). */
export const ADMIN_CSRF_HEADER = 'x-admin-request';

const ROLES = 'adminRoles';
/** Roles allowed besides the owner (who may do everything); none listed = owner only. */
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ROLES, roles);

export type AdminRequest = FastifyRequest & { admin?: AdminMe };

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminMe => {
  const admin = ctx.switchToHttp().getRequest<AdminRequest>().admin;
  if (!admin) throw new Error('CurrentAdmin used without AdminGuard');
  return admin;
});

export function readCookie(request: FastifyRequest, name: string): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** Admin routes: a live admin session from the cookie, the CSRF header on mutations, the role. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (request.method !== 'GET' && request.headers[ADMIN_CSRF_HEADER] !== '1')
      throw new AppError(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN);
    const token = readCookie(request, ADMIN_COOKIE);
    const admin = token ? await this.auth.resolve(token) : null;
    if (!admin) throw new AppError(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);
    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Routes without explicit roles are owner-only.
    if (admin.role !== 'owner' && !roles?.includes(admin.role))
      throw new AppError(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN);
    request.admin = admin;
    return true;
  }
}
