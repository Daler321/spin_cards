import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@spincards/shared';
import { jwtVerify, SignJWT } from 'jose';
import { AppError } from '../common/app-error.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { IssuedTokens } from '@spincards/shared';

const ISSUER = 'spincards-api';
const AUDIENCE = 'spincards-player';

@Injectable()
export class TokensService {
  private readonly secret: Uint8Array;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {
    this.secret = new TextEncoder().encode(env.JWT_SECRET);
  }

  async issue(userId: string, familyId: string = randomUUID()): Promise<IssuedTokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      },
    });
    return {
      accessToken: await this.signAccess(userId),
      expiresIn: this.env.ACCESS_TOKEN_TTL_SEC,
      refreshToken,
    };
  }

  /** Returns the user id, or null for an invalid or expired token. */
  async verifyAccess(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  /**
   * Rotates a refresh token. Presenting an already rotated token revokes its whole family:
   * it was probably stolen.
   */
  async rotate(refreshToken: string): Promise<IssuedTokens> {
    const now = new Date();
    const current = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (!current || current.expiresAt <= now) throw invalidRefresh();
    if (current.revokedAt) {
      await this.revokeFamily(current.familyId);
      throw invalidRefresh();
    }

    // Conditional revoke: only one of two concurrent rotations of the same token wins.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: current.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (count === 0) {
      await this.revokeFamily(current.familyId);
      throw invalidRefresh();
    }
    return this.issue(current.userId, current.familyId);
  }

  async revoke(refreshToken: string): Promise<void> {
    const current = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (current) await this.revokeFamily(current.familyId);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private signAccess(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.env.ACCESS_TOKEN_TTL_SEC}s`)
      .sign(this.secret);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function invalidRefresh(): AppError {
  return new AppError(ErrorCode.INVALID_REFRESH_TOKEN, HttpStatus.UNAUTHORIZED);
}
