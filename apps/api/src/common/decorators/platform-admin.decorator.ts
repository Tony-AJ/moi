import { SetMetadata } from '@nestjs/common';

export const PLATFORM_ADMIN_KEY = 'moi:platform-admin';

/**
 * Restricts a route to platform operators (PlatformRole SUPER_ADMIN).
 * Checked by AdminAuthGuard after the token and account have been verified.
 */
export const PlatformAdminOnly = () => SetMetadata(PLATFORM_ADMIN_KEY, true);
