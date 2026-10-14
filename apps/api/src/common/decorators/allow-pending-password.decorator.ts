import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_PASSWORD_KEY = 'moi:allow-pending-password';

/**
 * Marks the few routes a user may call while their password is still the
 * one somebody else issued them: reading their own profile and replacing the
 * password. Everything else is refused until they do.
 */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);
