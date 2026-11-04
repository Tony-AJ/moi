import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AdminRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ALLOW_PENDING_PASSWORD_KEY } from '../decorators/allow-pending-password.decorator';
import { PLATFORM_ADMIN_KEY } from '../decorators/platform-admin.decorator';

/** Machine-readable reason, so the admin app can route to the change form. */
export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED';

/**
 * Every /admin route is closed by default. The token is verified AND the admin
 * row is re-read on each request so a deactivated account loses access
 * immediately instead of at token expiry.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(header.slice(7).trim());
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        platformRole: true,
        mustChangePassword: true,
        isActive: true,
      },
    });

    if (!admin?.isActive) {
      throw new UnauthorizedException('Admin account is not active');
    }

    const targets = [context.getHandler(), context.getClass()];

    // An issued password travelled through somebody else's hands. Until it is
    // replaced it opens the profile and the change form, and nothing else.
    if (
      admin.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_KEY, targets)
    ) {
      throw new ForbiddenException({
        message: 'Choose a new password before continuing',
        code: PASSWORD_CHANGE_REQUIRED,
      });
    }

    if (
      this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, targets) &&
      admin.platformRole !== 'SUPER_ADMIN'
    ) {
      throw new ForbiddenException('Platform administrators only');
    }

    const required = this.reflector.getAllAndOverride<AdminRole[]>(ROLES_KEY, targets);

    if (required?.length && !required.includes(admin.role)) {
      throw new ForbiddenException('Insufficient role');
    }

    request.admin = {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      platformRole: admin.platformRole,
      mustChangePassword: admin.mustChangePassword,
      actingWorkspaceId: (request.headers?.['x-workspace-id'] as string | undefined) || null,
    };
    return true;
  }
}
