import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AdminRole, PlatformRole } from '@prisma/client';

export interface AdminPrincipal {
  id: string;
  email: string;
  /** Legacy flat role. Authorization comes from workspace membership. */
  role: AdminRole;
  /** Platform-wide capability, not a licence to read customer data. */
  platformRole: PlatformRole;
  name: string;
}

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminPrincipal => {
    const request = ctx.switchToHttp().getRequest();
    return request.admin;
  },
);
