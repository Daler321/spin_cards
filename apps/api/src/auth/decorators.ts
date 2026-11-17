import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export const IS_PUBLIC = 'isPublic';
/** Route without authentication (health, auth, public config). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface RequestUser {
  id: string;
}

export type AuthedRequest = FastifyRequest & { user?: RequestUser };

/** The authenticated player (set by AuthGuard). */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestUser => {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw new Error('CurrentUser used on a public route');
    return user;
  },
);
