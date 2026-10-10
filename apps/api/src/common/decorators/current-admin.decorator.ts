import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AdminRole } from '@prisma/client';

export interface AdminPrincipal {
  id: string;
  email: string;
  role: AdminRole;
  name: string;
}

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminPrincipal => {
    const request = ctx.switchToHttp().getRequest();
    return request.admin;
  },
);
