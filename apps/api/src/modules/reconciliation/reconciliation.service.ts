import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { normalizeReference } from '../../common/utils/normalize.util';

export interface MatchOptions {
  /** How many days before/after the entry was created a credit may appear. */
  dateWindowDaysBefore?: number;
  dateWindowDaysAfter?: number;
  /** Allow a reference-less amount+date match to be flagged for review. */
  enableAmountFallback?: boolean;
}

export interface EntryMatchResult {
  entryId: string;
  entryCode: string;
  status: PaymentStatus;
  previousStatus: PaymentStatus;
  changed: boolean;
  reason: string;
  matchedBankTransactionId?: string;
  candidateCount: number;
}

export interface ReconciliationRunSummary {
  eventId: string;
  scannedEntries: number;
  verified: number;
  reviewRequired: number;
  notFound: number;
  unchanged: number;
  results: EntryMatchResult[];
  startedAt: string;
  finishedAt: string;
}

const DEFAULTS: Required<MatchOptions> = {
  dateWindowDaysBefore: 2,
  dateWindowDaysAfter: 14,
  enableAmountFallback: true,
};

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Attempts to verify a single entry against imported bank transactions.
   *
   * Rules (deliberately conservative):
   *  - Only an unmatched CREDIT transaction can verify an entry.
   *  - The credited amount must equal the entry amount exactly.
   *  - The transaction date must fall inside the configured window.
   *  - A reference (UTR) match with exactly one candidate -> VERIFIED.
   *  - More than one candidate -> REVIEW_REQUIRED (never auto verified).
   *  - Amount-only match -> REVIEW_REQUIRED, never VERIFIED.
   *  - A bank transaction already linked to another entry is never reused.
   */
  async matchEntry(
    entryId: string,
    options: MatchOptions = {},
    actorAdminId?: string | null,
  ): Promise<EntryMatchResult> {
    const opts = { ...DEFAULTS, ...options };

    const entry = await this.prisma.moiEntry.findUnique({
      where: { id: entryId },
      include: {
        paymentClaims: {
          where: { status: { in: ['CLAIMED', 'MATCHED'] } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!entry) throw new NotFoundException('Entry not found');

    const previousStatus = entry.paymentStatus;

    // Cash entries are settled by an explicit admin attestation, not by the
    // bank statement, so reconciliation leaves them untouched.
    if (entry.paymentMethod === 'CASH') {
      return {
        entryId: entry.id,
        entryCode: entry.entryCode,
        status: previousStatus,
        previousStatus,
        changed: false,
        reason: 'Cash entry - confirmed by an admin, not by the bank statement',
        candidateCount: 0,
      };
    }

    if (previousStatus === 'VERIFIED' || previousStatus === 'REJECTED') {
      return {
        entryId: entry.id,
        entryCode: entry.entryCode,
        status: previousStatus,
        previousStatus,
        changed: false,
        reason: 'Entry already ' + previousStatus.toLowerCase(),
        candidateCount: 0,
      };
    }

    const from = new Date(entry.createdAt);
    from.setDate(from.getDate() - opts.dateWindowDaysBefore);
    const to = new Date(entry.createdAt);
    to.setDate(to.getDate() + opts.dateWindowDaysAfter);

    const baseWhere: Prisma.BankTransactionWhereInput = {
      direction: 'CREDIT',
      matchedEntryId: null,
      amountPaise: entry.amountPaise,
      txnDate: { gte: from, lte: to },
      OR: [{ eventId: entry.eventId }, { eventId: null }],
    };

    const refs = entry.paymentClaims
      .map((claim) => claim.utrNormalized)
      .filter((value): value is string => Boolean(value));

    // --- Pass 1: reference match -------------------------------------------
    if (refs.length) {
      const refCandidates = await this.prisma.bankTransaction.findMany({
        where: {
          direction: 'CREDIT',
          matchedEntryId: null,
          amountPaise: entry.amountPaise,
          txnDate: { gte: from, lte: to },
          OR: refs.flatMap((ref) => [
            { refNormalized: ref },
            { refNormalized: { contains: ref } },
            { description: { contains: ref, mode: 'insensitive' as const } },
          ]),
        },
        take: 10,
      });

      if (refCandidates.length === 1) {
        return this.applyMatch(entry.id, entry.entryCode, refCandidates[0].id, previousStatus, {
          reason:
            'Matched bank credit by reference ' +
            (refCandidates[0].reference ?? '(found in narration)'),
          claimId: entry.paymentClaims[0]?.id,
          actorAdminId,
        });
      }

      if (refCandidates.length > 1) {
        return this.applyStatus(entry.id, entry.entryCode, previousStatus, 'REVIEW_REQUIRED', {
          reason: refCandidates.length + ' bank credits match this reference and amount',
          candidateCount: refCandidates.length,
          actorAdminId,
        });
      }
    }

    // --- Pass 2: amount + date fallback (review only) -----------------------
    if (opts.enableAmountFallback) {
      const amountCandidates = await this.prisma.bankTransaction.findMany({
        where: baseWhere,
        take: 10,
      });

      if (amountCandidates.length >= 1) {
        return this.applyStatus(entry.id, entry.entryCode, previousStatus, 'REVIEW_REQUIRED', {
          reason: refs.length
            ? 'Reference not found in the statement, but ' +
              amountCandidates.length +
              ' unmatched credit(s) of the same amount exist'
            : 'No reference submitted; ' +
              amountCandidates.length +
              ' unmatched credit(s) of the same amount exist',
          candidateCount: amountCandidates.length,
          actorAdminId,
        });
      }
    }

    // --- No candidates ------------------------------------------------------
    return this.applyStatus(entry.id, entry.entryCode, previousStatus, 'NOT_FOUND', {
      reason:
        'No matching credit in the imported statements. The statement may be incomplete or the payment may not have settled yet.',
      candidateCount: 0,
      actorAdminId,
    });
  }

  async runForEvent(
    eventId: string,
    options: MatchOptions = {},
    actorAdminId?: string | null,
  ): Promise<ReconciliationRunSummary> {
    const startedAt = new Date();

    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const entries = await this.prisma.moiEntry.findMany({
      where: {
        eventId,
        paymentMethod: { not: 'CASH' },
        paymentStatus: { in: ['AWAITING_VERIFICATION', 'REVIEW_REQUIRED', 'NOT_FOUND'] },
      },
      select: { id: true },
      orderBy: { entryNumber: 'asc' },
    });

    const results: EntryMatchResult[] = [];
    for (const { id } of entries) {
      try {
        results.push(await this.matchEntry(id, options, actorAdminId));
      } catch (error) {
        this.logger.warn('Reconciliation failed for entry ' + id + ': ' + String(error));
      }
    }

    const summary: ReconciliationRunSummary = {
      eventId,
      scannedEntries: entries.length,
      verified: results.filter((r) => r.status === 'VERIFIED').length,
      reviewRequired: results.filter((r) => r.status === 'REVIEW_REQUIRED').length,
      notFound: results.filter((r) => r.status === 'NOT_FOUND').length,
      unchanged: results.filter((r) => !r.changed).length,
      results,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };

    await this.audit.record({
      adminUserId: actorAdminId ?? null,
      action: 'RECONCILIATION_RUN',
      entityType: 'Event',
      entityId: eventId,
      metadata: {
        scannedEntries: summary.scannedEntries,
        verified: summary.verified,
        reviewRequired: summary.reviewRequired,
        notFound: summary.notFound,
      },
    });

    return summary;
  }

  /**
   * Links a bank transaction to an entry and marks it VERIFIED.
   * The conditional update on matchedEntryId is what prevents one bank
   * transaction from verifying two entries under concurrent requests.
   */
  async applyMatch(
    entryId: string,
    entryCode: string,
    bankTransactionId: string,
    previousStatus: PaymentStatus,
    meta: { reason: string; claimId?: string; actorAdminId?: string | null; manual?: boolean },
  ): Promise<EntryMatchResult> {
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.bankTransaction.updateMany({
        where: { id: bankTransactionId, matchedEntryId: null },
        data: { matchedEntryId: entryId, matchedAt: now, matchNote: meta.reason },
      });

      if (claimed.count !== 1) {
        throw new Error('That bank transaction is already matched to another entry');
      }

      await tx.moiEntry.update({
        where: { id: entryId },
        data: {
          paymentStatus: 'VERIFIED',
          verifiedAt: now,
          verifiedByAdminId: meta.manual ? meta.actorAdminId ?? null : null,
          lastReconciledAt: now,
          reviewReason: null,
        },
      });

      if (meta.claimId) {
        await tx.paymentClaim.update({
          where: { id: meta.claimId },
          data: {
            status: 'MATCHED',
            matchedBankTransactionId: bankTransactionId,
            matchedAt: now,
          },
        });
      }
    });

    await this.audit.record({
      adminUserId: meta.actorAdminId ?? null,
      action: meta.manual ? 'ENTRY_VERIFIED_MANUAL' : 'ENTRY_VERIFIED_AUTO',
      entityType: 'MoiEntry',
      entityId: entryId,
      metadata: { bankTransactionId, reason: meta.reason, previousStatus },
    });

    return {
      entryId,
      entryCode,
      status: 'VERIFIED',
      previousStatus,
      changed: previousStatus !== 'VERIFIED',
      reason: meta.reason,
      matchedBankTransactionId: bankTransactionId,
      candidateCount: 1,
    };
  }

  private async applyStatus(
    entryId: string,
    entryCode: string,
    previousStatus: PaymentStatus,
    status: PaymentStatus,
    meta: { reason: string; candidateCount: number; actorAdminId?: string | null },
  ): Promise<EntryMatchResult> {
    await this.prisma.moiEntry.update({
      where: { id: entryId },
      data: {
        paymentStatus: status,
        lastReconciledAt: new Date(),
        reviewReason: status === 'VERIFIED' ? null : meta.reason,
      },
    });

    if (previousStatus !== status) {
      await this.audit.record({
        adminUserId: meta.actorAdminId ?? null,
        action: 'ENTRY_STATUS_CHANGED',
        entityType: 'MoiEntry',
        entityId: entryId,
        metadata: { from: previousStatus, to: status, reason: meta.reason },
      });
    }

    return {
      entryId,
      entryCode,
      status,
      previousStatus,
      changed: previousStatus !== status,
      reason: meta.reason,
      candidateCount: meta.candidateCount,
    };
  }

  /** Candidate credits an admin can pick from when resolving a review. */
  async findCandidates(entryId: string, options: MatchOptions = {}) {
    const opts = { ...DEFAULTS, ...options };
    const entry = await this.prisma.moiEntry.findUnique({
      where: { id: entryId },
      include: { paymentClaims: { orderBy: { createdAt: 'desc' } } },
    });
    if (!entry) throw new NotFoundException('Entry not found');

    const from = new Date(entry.createdAt);
    from.setDate(from.getDate() - opts.dateWindowDaysBefore);
    const to = new Date(entry.createdAt);
    to.setDate(to.getDate() + opts.dateWindowDaysAfter);

    const refs = entry.paymentClaims
      .map((c) => c.utrNormalized)
      .filter((v): v is string => Boolean(v));

    const candidates = await this.prisma.bankTransaction.findMany({
      where: {
        direction: 'CREDIT',
        matchedEntryId: null,
        txnDate: { gte: from, lte: to },
        OR: [
          { amountPaise: entry.amountPaise },
          ...refs.map((ref) => ({ refNormalized: { contains: ref } })),
        ],
      },
      orderBy: { txnDate: 'desc' },
      take: 50,
    });

    return candidates.map((txn) => ({
      ...txn,
      balancePaise: txn.balancePaise === null ? null : Number(txn.balancePaise),
      amountMatches: txn.amountPaise === entry.amountPaise,
      referenceMatches: refs.some(
        (ref) =>
          txn.refNormalized?.includes(ref) ||
          Boolean(normalizeReference(txn.description)?.includes(ref)),
      ),
    }));
  }
}
