-- Rescopes the two statement dedupe constraints from global to per-tenant.
-- Both were cross-customer defects: a global fileHash lets one customer's
-- upload reveal itself to and block another's byte-identical file, and a
-- global rowHash makes a second customer's legitimate row disappear behind
-- skipDuplicates, leaving a guest who really paid stuck unverified.
-- Relaxing a unique constraint cannot fail on existing data.

-- DropIndex
DROP INDEX "bank_statement_imports_fileHash_key";

-- DropIndex
DROP INDEX "bank_transactions_rowHash_key";

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_imports_workspaceId_fileHash_key" ON "bank_statement_imports"("workspaceId", "fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_beneficiaryAccountId_rowHash_key" ON "bank_transactions"("beneficiaryAccountId", "rowHash");

