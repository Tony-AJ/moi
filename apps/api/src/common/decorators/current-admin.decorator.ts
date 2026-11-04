import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AdminRole, PlatformRole } from '@prisma/client';

export interface AdminPrincipal {
  id: string;
  email: string;
  /** Legacy flat role. Authorization comes from workspace membership. */
  role: AdminRole;
  /** Platform-wide capability, not a licence to read customer data. */
  platformRole: PlatformRole;
  /** True while the user still holds a password somebody else issued. */
  mustChangePassword: boolean;
  /**
   * Workspace a super admin is acting in, from the X-Workspace-Id header.
   * For anyone else it is only a request, checked against their memberships.
   */
  actingWorkspaceId?: string | null;
  name: string;
}

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminPrincipal => {
    const request = ctx.switchToHttp().getRequest();
    return request.admin;
  },
);
