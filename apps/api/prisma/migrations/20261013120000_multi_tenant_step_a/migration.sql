-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('WORKSPACE_OWNER', 'WORKSPACE_ADMIN', 'EVENT_STAFF');

-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BeneficiaryStatus" AS ENUM ('UNCONFIRMED', 'CONFIRMED', 'DISABLED');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "activePaymentConfigId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "moi_entries" ADD COLUMN     "paymentConfigId" TEXT;

-- AlterTable
ALTER TABLE "bank_statement_imports" ADD COLUMN     "beneficiaryAccountId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "bank_transactions" ADD COLUMN     "beneficiaryAccountId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "isSupportAccess" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "workspaceId" TEXT;

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'PENDING',
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_invites" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedByUserId" TEXT,
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "grantedEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_members" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canRecordEntries" BOOLEAN NOT NULL DEFAULT true,
    "canUploadStatements" BOOLEAN NOT NULL DEFAULT false,
    "canResolveReviews" BOOLEAN NOT NULL DEFAULT false,
    "canExportReports" BOOLEAN NOT NULL DEFAULT false,
    "assignedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiary_accounts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "upiId" TEXT NOT NULL,
    "payeeName" TEXT NOT NULL,
    "bankName" TEXT,
    "accountLast4" TEXT,
    "status" "BeneficiaryStatus" NOT NULL DEFAULT 'UNCONFIRMED',
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beneficiary_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_payment_configs" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "beneficiaryAccountId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "upiIdSnapshot" TEXT NOT NULL,
    "payeeNameSnapshot" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_payment_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "workspaces_status_idx" ON "workspaces"("status");

-- CreateIndex
CREATE INDEX "workspace_members_userId_status_idx" ON "workspace_members"("userId", "status");

-- CreateIndex
CREATE INDEX "workspace_members_workspaceId_role_idx" ON "workspace_members"("workspaceId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspaceId_userId_key" ON "workspace_members"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invites_tokenHash_key" ON "workspace_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "workspace_invites_email_idx" ON "workspace_invites"("email");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invites_workspaceId_email_status_key" ON "workspace_invites"("workspaceId", "email", "status");

-- CreateIndex
CREATE INDEX "event_members_userId_idx" ON "event_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "event_members_eventId_userId_key" ON "event_members"("eventId", "userId");

-- CreateIndex
CREATE INDEX "beneficiary_accounts_workspaceId_status_idx" ON "beneficiary_accounts"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "beneficiary_accounts_workspaceId_upiId_key" ON "beneficiary_accounts"("workspaceId", "upiId");

-- CreateIndex
CREATE INDEX "event_payment_configs_beneficiaryAccountId_idx" ON "event_payment_configs"("beneficiaryAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "event_payment_configs_eventId_version_key" ON "event_payment_configs"("eventId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "events_activePaymentConfigId_key" ON "events"("activePaymentConfigId");

-- CreateIndex
CREATE INDEX "events_workspaceId_idx" ON "events"("workspaceId");

-- CreateIndex
CREATE INDEX "bank_statement_imports_workspaceId_idx" ON "bank_statement_imports"("workspaceId");

-- CreateIndex
CREATE INDEX "bank_statement_imports_beneficiaryAccountId_idx" ON "bank_statement_imports"("beneficiaryAccountId");

-- CreateIndex
CREATE INDEX "bank_transactions_beneficiaryAccountId_direction_matchedEnt_idx" ON "bank_transactions"("beneficiaryAccountId", "direction", "matchedEntryId");

-- CreateIndex
CREATE INDEX "bank_transactions_workspaceId_idx" ON "bank_transactions"("workspaceId");

-- CreateIndex
CREATE INDEX "audit_logs_workspaceId_createdAt_idx" ON "audit_logs"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_isSupportAccess_createdAt_idx" ON "audit_logs"("isSupportAccess", "createdAt");

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_members" ADD CONSTRAINT "event_members_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_members" ADD CONSTRAINT "event_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_members" ADD CONSTRAINT "event_members_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiary_accounts" ADD CONSTRAINT "beneficiary_accounts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiary_accounts" ADD CONSTRAINT "beneficiary_accounts_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_payment_configs" ADD CONSTRAINT "event_payment_configs_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_payment_configs" ADD CONSTRAINT "event_payment_configs_beneficiaryAccountId_fkey" FOREIGN KEY ("beneficiaryAccountId") REFERENCES "beneficiary_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_payment_configs" ADD CONSTRAINT "event_payment_configs_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_activePaymentConfigId_fkey" FOREIGN KEY ("activePaymentConfigId") REFERENCES "event_payment_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moi_entries" ADD CONSTRAINT "moi_entries_paymentConfigId_fkey" FOREIGN KEY ("paymentConfigId") REFERENCES "event_payment_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_beneficiaryAccountId_fkey" FOREIGN KEY ("beneficiaryAccountId") REFERENCES "beneficiary_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_beneficiaryAccountId_fkey" FOREIGN KEY ("beneficiaryAccountId") REFERENCES "beneficiary_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===========================================================================
-- BACKFILL (step B)
--
-- Moves every pre-existing row into one initial workspace. Written so that
-- it is a no-op on an empty database and idempotent if re-run by hand.
-- Nothing is deleted and no existing column is modified except the new
-- nullable tenant columns.
-- ===========================================================================

-- 1. The initial workspace. Created only when there is data to move.
INSERT INTO "workspaces" ("id", "slug", "name", "status", "activatedAt", "createdAt", "updatedAt")
SELECT
  'ws_initial_backfill',
  'initial-workspace',
  'Initial workspace',
  'ACTIVE',
  NOW(),
  NOW(),
  NOW()
WHERE EXISTS (SELECT 1 FROM "admin_users")
   OR EXISTS (SELECT 1 FROM "events")
ON CONFLICT ("id") DO NOTHING;

-- 2. Every existing event joins it. Events are global today, so all of them
--    belong to the one pre-existing customer.
UPDATE "events"
SET "workspaceId" = 'ws_initial_backfill'
WHERE "workspaceId" IS NULL
  AND EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = 'ws_initial_backfill');

-- 3. Memberships from the legacy flat role.
--    OWNER  -> WORKSPACE_OWNER
--    STAFF  -> EVENT_STAFF
INSERT INTO "workspace_members" ("id", "workspaceId", "userId", "role", "status", "acceptedAt", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  'ws_initial_backfill',
  u."id",
  CASE WHEN u."role" = 'OWNER' THEN 'WORKSPACE_OWNER'::"WorkspaceRole" ELSE 'EVENT_STAFF'::"WorkspaceRole" END,
  'ACTIVE',
  NOW(),
  NOW(),
  NOW()
FROM "admin_users" u
WHERE EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = 'ws_initial_backfill')
ON CONFLICT ("workspaceId", "userId") DO NOTHING;

-- 4. The legacy OWNER also becomes the platform's first SUPER_ADMIN.
--    Without this nobody can provision a second workspace after the
--    migration. Create a dedicated super-admin account and demote this one
--    back to USER before going live with real customers.
UPDATE "admin_users"
SET "platformRole" = 'SUPER_ADMIN'
WHERE "role" = 'OWNER';

-- 5. Existing STAFF kept full reach over every event before this migration.
--    Grant the matching event assignments so no one silently loses access.
INSERT INTO "event_members" ("id", "eventId", "userId", "canRecordEntries", "canUploadStatements", "canResolveReviews", "canExportReports", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  e."id",
  u."id",
  true, true, true, true,
  NOW(),
  NOW()
FROM "events" e
CROSS JOIN "admin_users" u
WHERE u."role" = 'STAFF'
  AND e."workspaceId" = 'ws_initial_backfill'
ON CONFLICT ("eventId", "userId") DO NOTHING;

-- 6. One beneficiary account per distinct UPI id already configured on an
--    event. Marked CONFIRMED because these were in live use; new accounts
--    start UNCONFIRMED and require explicit owner confirmation.
--    Events with no upiId get no beneficiary on purpose: the removed
--    DEFAULT_UPI_ID fallback must not resurface as a silent default.
INSERT INTO "beneficiary_accounts" ("id", "workspaceId", "label", "upiId", "payeeName", "status", "confirmedAt", "createdAt", "updatedAt")
SELECT
  'ben_' || md5(src."upiId"),
  'ws_initial_backfill',
  'Migrated: ' || src."upiId",
  src."upiId",
  src."payeeName",
  'CONFIRMED',
  NOW(),
  NOW(),
  NOW()
FROM (
  SELECT
    e."upiId" AS "upiId",
    MIN(COALESCE(e."upiPayeeName", 'Moi Ledger')) AS "payeeName"
  FROM "events" e
  WHERE e."upiId" IS NOT NULL
    AND e."workspaceId" = 'ws_initial_backfill'
  GROUP BY e."upiId"
) src
ON CONFLICT ("workspaceId", "upiId") DO NOTHING;

-- 7. Version 1 payment config per event that had a UPI id. The snapshot
--    columns freeze the values the guests were actually handed.
INSERT INTO "event_payment_configs" ("id", "eventId", "beneficiaryAccountId", "version", "upiIdSnapshot", "payeeNameSnapshot", "effectiveFrom", "createdAt")
SELECT
  'epc_v1_' || e."id",
  e."id",
  b."id",
  1,
  e."upiId",
  COALESCE(e."upiPayeeName", b."payeeName"),
  e."createdAt",
  NOW()
FROM "events" e
JOIN "beneficiary_accounts" b
  ON b."workspaceId" = e."workspaceId"
 AND b."upiId" = e."upiId"
WHERE e."upiId" IS NOT NULL
  AND e."workspaceId" = 'ws_initial_backfill'
ON CONFLICT ("eventId", "version") DO NOTHING;

-- 8. Point each event at its version 1 config.
UPDATE "events" e
SET "activePaymentConfigId" = c."id"
FROM "event_payment_configs" c
WHERE c."eventId" = e."id"
  AND c."version" = 1
  AND e."activePaymentConfigId" IS NULL;

-- 9. Pin existing entries to the config that was in force. CASH entries keep
--    a null config: no UPI beneficiary was involved.
UPDATE "moi_entries" m
SET "paymentConfigId" = e."activePaymentConfigId"
FROM "events" e
WHERE e."id" = m."eventId"
  AND m."paymentConfigId" IS NULL
  AND m."paymentMethod" <> 'CASH'
  AND e."activePaymentConfigId" IS NOT NULL;

-- 10. Statement imports move to the workspace, and to the beneficiary
--     account of the event they were uploaded against. An import with no
--     event cannot be attributed to an account, so it keeps a null
--     beneficiary and is excluded from matching until an operator assigns
--     one. That is deliberate: a null must no longer mean "any account".
UPDATE "bank_statement_imports" i
SET "workspaceId" = 'ws_initial_backfill'
WHERE i."workspaceId" IS NULL
  AND EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = 'ws_initial_backfill');

UPDATE "bank_statement_imports" i
SET "beneficiaryAccountId" = c."beneficiaryAccountId"
FROM "events" e
JOIN "event_payment_configs" c ON c."id" = e."activePaymentConfigId"
WHERE e."id" = i."eventId"
  AND i."beneficiaryAccountId" IS NULL;

-- 11. Transactions inherit the tenant columns from their import.
UPDATE "bank_transactions" t
SET "workspaceId" = i."workspaceId",
    "beneficiaryAccountId" = i."beneficiaryAccountId"
FROM "bank_statement_imports" i
WHERE i."id" = t."importId"
  AND t."workspaceId" IS NULL;

-- 12. Audit rows that name an event get its workspace. Platform-level rows
--     (logins, password changes) correctly keep a null workspace.
UPDATE "audit_logs" a
SET "workspaceId" = e."workspaceId"
FROM "events" e
WHERE a."entityType" = 'Event'
  AND a."entityId" = e."id"
  AND a."workspaceId" IS NULL;
