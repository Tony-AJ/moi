-- Organizers can no longer change their own password; only the super admin
-- sets it. Anyone still flagged for a forced change would be locked out, so
-- clear the flag. The column stays for super admin accounts.
UPDATE "admin_users" SET "mustChangePassword" = false WHERE "platformRole" <> 'SUPER_ADMIN';

-- AlterTable: sessions opened before a password reset are refused.
ALTER TABLE "admin_users" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
