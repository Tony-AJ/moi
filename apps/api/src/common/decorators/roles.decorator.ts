import { SetMetadata } from '@nestjs/common';
import type { AdminRole } from '@prisma/client';

export const ROLES_KEY = 'moi:roles';
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);
