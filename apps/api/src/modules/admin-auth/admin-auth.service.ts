import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto, ip?: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });

    // Same error and roughly the same work for unknown email and wrong
    // password, so the response does not reveal which accounts exist.
    const hash = admin?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali';
    const passwordOk = await bcrypt.compare(dto.password, hash);

    if (!admin || !passwordOk || !admin.isActive) {
      await this.audit.record({
        action: 'ADMIN_LOGIN_FAILED',
        entityType: 'AdminUser',
        entityId: admin?.id ?? null,
        ip,
        metadata: { email: dto.email },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.record({
      adminUserId: admin.id,
      action: 'ADMIN_LOGIN',
      entityType: 'AdminUser',
      entityId: admin.id,
      ip,
    });

    const accessToken = await this.jwt.signAsync({
      sub: admin.id,
      email: admin.email,
      role: admin.role,
    });

    return { accessToken, admin: await this.profile(admin.id) };
  }

  async me(adminId: string) {
    return this.profile(adminId);
  }

  /**
   * What the admin app needs to decide where a user lands: the platform
   * console, their own workspace, or the forced password change. Only active
   * memberships are listed; a revoked one grants nothing and is not shown.
   */
  private async profile(adminId: string) {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({
      where: { id: adminId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        platformRole: true,
        mustChangePassword: true,
        lastLoginAt: true,
        memberships: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          select: {
            role: true,
            workspace: { select: { id: true, name: true, slug: true, status: true } },
          },
        },
      },
    });

    const { memberships, ...rest } = admin;
    return {
      ...rest,
      memberships: memberships.map((membership) => ({
        workspaceId: membership.workspace.id,
        workspaceName: membership.workspace.name,
        workspaceSlug: membership.workspace.slug,
        workspaceStatus: membership.workspace.status,
        role: membership.role,
      })),
    };
  }

  async changePassword(adminId: string, dto: ChangePasswordDto, ip?: string) {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    const ok = await bcrypt.compare(dto.currentPassword, admin.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different');
    }

    await this.prisma.adminUser.update({
      where: { id: adminId },
      // Choosing their own password is what retires an issued one.
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, 12),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'ADMIN_PASSWORD_CHANGED',
      entityType: 'AdminUser',
      entityId: adminId,
      ip,
      metadata: { replacedIssuedPassword: admin.mustChangePassword },
    });

    return { ok: true, profile: await this.profile(adminId) };
  }
}
