import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type AdminLoginResponse, type AdminMe, ErrorCode } from '@spincards/shared';
import type { Redis } from 'ioredis';
import { AppError } from '../common/app-error.js';
import { ENV, type Env } from '../config/env.js';
import type { AdminUser } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';
import { verifyPassword } from '../seed/password.js';
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUrl, verifyTotp } from './totp.js';

const MAX_FAILURES = 5;
const LOCK_SEC = 15 * 60;
const SETUP_TTL_SEC = 10 * 60;
const TOUCH_EVERY_MS = 60_000;
const ISSUER = 'SpinCards Admin';

export interface AdminSessionIssued {
  token: string;
  maxAgeSec: number;
}

/**
 * Admin sign-in (TZ 15, CLAUDE.md): password (scrypt) plus TOTP. The first login sets TOTP up: the
 * secret is shown once and saved, encrypted, after a correct code. Five failures lock the login for
 * 15 minutes; a TOTP code works once. Sessions are random tokens stored as SHA-256 hashes, with an
 * absolute lifetime and an idle timeout; every login and logout goes to audit_log.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get secretKey(): string {
    if (!this.env.ADMIN_SECRET_KEY) throw new Error('ADMIN_SECRET_KEY is not set');
    return this.env.ADMIN_SECRET_KEY;
  }

  async login(
    login: string,
    password: string,
    totp: string | undefined,
  ): Promise<{ response: AdminLoginResponse; session?: AdminSessionIssued }> {
    const failKey = `admin:fail:${login.toLowerCase()}`;
    if (Number(await this.redis.get(failKey)) >= MAX_FAILURES)
      throw new AppError(ErrorCode.ADMIN_LOCKED, HttpStatus.TOO_MANY_REQUESTS);

    const admin = await this.prisma.adminUser.findUnique({ where: { login } });
    const passwordOk = admin?.isActive && (await verifyPassword(password, admin.passwordHash));
    if (!admin || !passwordOk) {
      await this.fail(failKey, admin?.id ?? null, 'password');
      throw new AppError(ErrorCode.ADMIN_INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED);
    }

    if (!admin.totpSecret) {
      const secret = newTotpSecret();
      const setupToken = randomBytes(24).toString('base64url');
      await this.redis.set(
        `admin:setup:${setupToken}`,
        JSON.stringify({ adminId: admin.id, secret }),
        'EX',
        SETUP_TTL_SEC,
      );
      return {
        response: {
          stage: 'totp_setup',
          setupToken,
          secret,
          otpauthUrl: otpauthUrl(secret, admin.login, ISSUER),
        },
      };
    }
    if (!totp) return { response: { stage: 'totp_required' } };
    if (!(await this.acceptCode(admin, decryptSecret(admin.totpSecret, this.secretKey), totp))) {
      await this.fail(failKey, admin.id, 'totp');
      throw new AppError(ErrorCode.ADMIN_TOTP_INVALID, HttpStatus.UNAUTHORIZED);
    }
    await this.redis.del(failKey);
    return this.signIn(admin);
  }

  /** Finishes the first login: a correct code from the new secret saves it and signs in. */
  async setupTotp(
    setupToken: string,
    code: string,
  ): Promise<{ response: AdminLoginResponse; session: AdminSessionIssued }> {
    const raw = await this.redis.get(`admin:setup:${setupToken}`);
    if (!raw) throw new AppError(ErrorCode.ADMIN_INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED);
    const { adminId, secret } = JSON.parse(raw) as { adminId: string; secret: string };
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin?.isActive || admin.totpSecret)
      throw new AppError(ErrorCode.ADMIN_INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED);
    if (!(await this.acceptCode(admin, secret, code)))
      throw new AppError(ErrorCode.ADMIN_TOTP_INVALID, HttpStatus.UNAUTHORIZED);
    await this.redis.del(`admin:setup:${setupToken}`);
    const updated = await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { totpSecret: encryptSecret(secret, this.secretKey) },
    });
    await this.audit(admin.id, 'admin.totp_setup');
    return this.signIn(updated);
  }

  /** The admin behind a session cookie, or null (expired, idle, revoked, deactivated). */
  async resolve(token: string, now = new Date()): Promise<AdminMe | null> {
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { admin: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= now || !session.admin.isActive)
      return null;
    if (now.getTime() - session.lastSeenAt.getTime() > this.env.ADMIN_SESSION_IDLE_MIN * 60_000)
      return null;
    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_EVERY_MS)
      await this.prisma.adminSession.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      });
    return meOf(session.admin);
  }

  async logout(token: string): Promise<void> {
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!session || session.revokedAt) return;
    await this.prisma.adminSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    await this.audit(session.adminId, 'admin.logout');
  }

  private async signIn(
    admin: AdminUser,
  ): Promise<{ response: AdminLoginResponse; session: AdminSessionIssued }> {
    const token = randomBytes(32).toString('base64url');
    const maxAgeSec = this.env.ADMIN_SESSION_HOURS * 3600;
    await this.prisma.adminSession.create({
      data: {
        adminId: admin.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + maxAgeSec * 1000),
      },
    });
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit(admin.id, 'admin.login');
    return { response: { stage: 'done', admin: meOf(admin) }, session: { token, maxAgeSec } };
  }

  /** A valid code that was not used before (its 30-second step is newer than the last one). */
  private async acceptCode(admin: AdminUser, secret: string, code: string): Promise<boolean> {
    const counter = verifyTotp(secret, code);
    if (counter === null) return false;
    const key = `admin:totp:last:${admin.id}`;
    const last = Number(await this.redis.get(key));
    if (counter <= last) return false;
    await this.redis.set(key, String(counter), 'EX', 300);
    return true;
  }

  private async fail(failKey: string, adminId: string | null, step: string): Promise<void> {
    const count = await this.redis.incr(failKey);
    if (count === 1) await this.redis.expire(failKey, LOCK_SEC);
    if (adminId) await this.audit(adminId, 'admin.login_failed', { step });
  }

  private async audit(adminId: string, action: string, payload: object = {}): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorType: 'admin',
        actorId: adminId,
        action,
        targetType: 'admin',
        targetId: adminId,
        payload,
      },
    });
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function meOf(admin: AdminUser): AdminMe {
  return { id: admin.id, login: admin.login, role: admin.role };
}
