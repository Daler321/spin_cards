import { HttpStatus, Injectable } from '@nestjs/common';
import { type AdminAccount, type AdminMe, type AdminRole, ErrorCode } from '@spincards/shared';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword } from '../seed/password.js';
import { auditAdmin } from './admin-users.service.js';

export interface AccountChanges {
  role?: AdminRole;
  isActive?: boolean;
  /** A new password set by the owner (the admin should change it afterwards). */
  password?: string;
  /** Forget the TOTP secret: the admin sets it up again on the next login. */
  resetTotp?: boolean;
}

/**
 * Admin accounts, managed by the owner (D-120). A new admin signs in with the temporary password
 * and sets up TOTP on the first login. Changes that could lock the panel out (the owner demoting or
 * disabling themselves, no active owner left) are refused.
 */
@Injectable()
export class AdminAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<AdminAccount[]> {
    const rows = await this.prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((a) => ({
      id: a.id,
      login: a.login,
      role: a.role,
      isActive: a.isActive,
      totpEnabled: a.totpSecret !== null,
      createdAt: a.createdAt.toISOString(),
      lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
    }));
  }

  async create(
    owner: AdminMe,
    input: { login: string; role: AdminRole; password: string },
    reason: string,
  ): Promise<void> {
    const passwordHash = await hashPassword(input.password);
    await this.prisma.transaction(async (tx) => {
      if (await tx.adminUser.findUnique({ where: { login: input.login } }))
        throw new AppError(ErrorCode.ADMIN_LOGIN_TAKEN, HttpStatus.CONFLICT);
      const created = await tx.adminUser.create({
        data: { login: input.login, role: input.role, passwordHash },
      });
      await auditAdmin(tx, owner, 'admin.create', { type: 'admin', id: created.id }, reason, {
        login: input.login,
        role: input.role,
      });
    });
  }

  async update(owner: AdminMe, id: string, changes: AccountChanges, reason: string): Promise<void> {
    const passwordHash = changes.password ? await hashPassword(changes.password) : undefined;
    await this.prisma.transaction(async (tx) => {
      const target = await tx.adminUser.findUnique({ where: { id } });
      if (!target) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
      const losesOwner =
        target.role === 'owner' &&
        ((changes.role !== undefined && changes.role !== 'owner') || changes.isActive === false);
      if (losesOwner && target.id === owner.id)
        throw new AppError(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN);
      if (losesOwner) {
        const owners = await tx.adminUser.count({ where: { role: 'owner', isActive: true } });
        if (owners <= 1) throw new AppError(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN);
      }

      await tx.adminUser.update({
        where: { id },
        data: {
          ...(changes.role && { role: changes.role }),
          ...(changes.isActive !== undefined && { isActive: changes.isActive }),
          ...(passwordHash && { passwordHash }),
          ...(changes.resetTotp && { totpSecret: null }),
        },
      });
      // Anything that changes access ends the admin's open sessions.
      if (changes.isActive === false || changes.role || passwordHash || changes.resetTotp) {
        await tx.adminSession.updateMany({
          where: { adminId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await auditAdmin(tx, owner, 'admin.update', { type: 'admin', id }, reason, {
        ...(changes.role && { role: changes.role }),
        ...(changes.isActive !== undefined && { isActive: changes.isActive }),
        ...(passwordHash && { passwordChanged: true }),
        ...(changes.resetTotp && { totpReset: true }),
      });
    });
  }
}
