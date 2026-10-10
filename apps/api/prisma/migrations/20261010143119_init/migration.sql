-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('AWAITING_VERIFICATION', 'VERIFIED', 'REVIEW_REQUIRED', 'NOT_FOUND', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('UPI', 'CASH', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentClaimSource" AS ENUM ('GUEST', 'ADMIN');

-- CreateEnum
CREATE TYPE "PaymentClaimStatus" AS ENUM ('CLAIMED', 'MATCHED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "TxnDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'STAFF');

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostName" TEXT,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "upiId" TEXT,
    "upiPayeeName" TEXT,
    "suggestedAmounts" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "minAmountPaise" INTEGER NOT NULL DEFAULT 100,
    "maxAmountPaise" INTEGER NOT NULL DEFAULT 10000000,
    "collectPhone" BOOLEAN NOT NULL DEFAULT false,
    "requirePhone" BOOLEAN NOT NULL DEFAULT false,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "entrySequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moi_entries" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "entryNumber" INTEGER NOT NULL,
    "entryCode" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestAddress" TEXT,
    "guestPhone" TEXT,
    "relation" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'UPI',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'AWAITING_VERIFICATION',
    "accessToken" TEXT NOT NULL,
    "clientRequestId" TEXT,
    "note" TEXT,
    "recordedByAdminId" TEXT,
    "verifiedByAdminId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "lastReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moi_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_claims" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "utr" TEXT NOT NULL,
    "utrNormalized" TEXT NOT NULL,
    "source" "PaymentClaimSource" NOT NULL DEFAULT 'GUEST',
    "status" "PaymentClaimStatus" NOT NULL DEFAULT 'CLAIMED',
    "matchedBankTransactionId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_imports" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "uploadedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "eventId" TEXT,
    "txnDate" TIMESTAMP(3) NOT NULL,
    "valueDate" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "refNormalized" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "direction" "TxnDirection" NOT NULL,
    "balancePaise" BIGINT,
    "rowHash" TEXT NOT NULL,
    "matchedEntryId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "matchNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "moi_entries_accessToken_key" ON "moi_entries"("accessToken");

-- CreateIndex
CREATE INDEX "moi_entries_eventId_paymentStatus_idx" ON "moi_entries"("eventId", "paymentStatus");

-- CreateIndex
CREATE INDEX "moi_entries_guestName_idx" ON "moi_entries"("guestName");

-- CreateIndex
CREATE UNIQUE INDEX "moi_entries_eventId_entryNumber_key" ON "moi_entries"("eventId", "entryNumber");

-- CreateIndex
CREATE UNIQUE INDEX "moi_entries_eventId_entryCode_key" ON "moi_entries"("eventId", "entryCode");

-- CreateIndex
CREATE UNIQUE INDEX "moi_entries_eventId_clientRequestId_key" ON "moi_entries"("eventId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_claims_utrNormalized_key" ON "payment_claims"("utrNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "payment_claims_matchedBankTransactionId_key" ON "payment_claims"("matchedBankTransactionId");

-- CreateIndex
CREATE INDEX "payment_claims_entryId_idx" ON "payment_claims"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_imports_fileHash_key" ON "bank_statement_imports"("fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_rowHash_key" ON "bank_transactions"("rowHash");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_matchedEntryId_key" ON "bank_transactions"("matchedEntryId");

-- CreateIndex
CREATE INDEX "bank_transactions_refNormalized_idx" ON "bank_transactions"("refNormalized");

-- CreateIndex
CREATE INDEX "bank_transactions_amountPaise_direction_idx" ON "bank_transactions"("amountPaise", "direction");

-- CreateIndex
CREATE INDEX "bank_transactions_txnDate_idx" ON "bank_transactions"("txnDate");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "moi_entries" ADD CONSTRAINT "moi_entries_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moi_entries" ADD CONSTRAINT "moi_entries_recordedByAdminId_fkey" FOREIGN KEY ("recordedByAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moi_entries" ADD CONSTRAINT "moi_entries_verifiedByAdminId_fkey" FOREIGN KEY ("verifiedByAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "moi_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_matchedBankTransactionId_fkey" FOREIGN KEY ("matchedBankTransactionId") REFERENCES "bank_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_uploadedByAdminId_fkey" FOREIGN KEY ("uploadedByAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_importId_fkey" FOREIGN KEY ("importId") REFERENCES "bank_statement_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matchedEntryId_fkey" FOREIGN KEY ("matchedEntryId") REFERENCES "moi_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
