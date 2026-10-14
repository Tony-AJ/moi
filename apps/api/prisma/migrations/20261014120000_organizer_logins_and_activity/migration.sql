-- Organizer logins issued by a super admin, and event-scoped activity.

-- AlterTable: a password issued by someone else must be replaced at first use.
ALTER TABLE "admin_users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: which event an audit row concerns, for per-event activity feeds.
ALTER TABLE "audit_logs" ADD COLUMN "eventId" TEXT;

-- Backfill eventId for rows written before the column existed, so an
-- organizer's feed includes their event's history and not just new actions.
UPDATE "audit_logs" AS a
SET "eventId" = a."entityId"
WHERE a."entityType" = 'Event'
  AND a."entityId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "events" e WHERE e."id" = a."entityId");

UPDATE "audit_logs" AS a
SET "eventId" = m."eventId"
FROM "moi_entries" AS m
WHERE a."entityType" = 'MoiEntry'
  AND a."entityId" = m."id";

UPDATE "audit_logs" AS a
SET "eventId" = b."eventId"
FROM "bank_statement_imports" AS b
WHERE a."entityType" = 'BankStatementImport'
  AND a."entityId" = b."id"
  AND b."eventId" IS NOT NULL;

-- Several entry and reconciliation actions were written without a workspace.
-- Now that the event is known, label them with the workspace that owns it,
-- otherwise they stay invisible to that workspace's activity feed.
UPDATE "audit_logs" AS a
SET "workspaceId" = e."workspaceId"
FROM "events" AS e
WHERE a."eventId" = e."id"
  AND a."workspaceId" IS NULL
  AND e."workspaceId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "audit_logs_workspaceId_eventId_createdAt_idx" ON "audit_logs"("workspaceId", "eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
