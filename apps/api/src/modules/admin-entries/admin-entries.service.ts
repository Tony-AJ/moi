import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { QueryEntriesDto } from './dto/query-entries.dto';
import {
  AdminSubmitReferenceDto,
  CreateManualEntryDto,
  ReviewEntryDto,
} from './dto/entry-actions.dto';
import { buildEntryCode, generateAccessToken } from '../../common/utils/token.util';
import { normalizePhone, normalizeReference } from '../../common/utils/normalize.util';
import {
  WorkspaceAccessService,
  type WorkspaceScope,
} from '../workspaces/workspace-access.service';

@Injectable()
export class AdminEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reconciliation: ReconciliationService,
    private readonly access: WorkspaceAccessService,
  ) {}

  /**
   * The scope argument is mandatory rather than optional on purpose: making
   * it part of the signature means a new caller cannot forget it and quietly
   * query across every customer. Callers obtain it from
   * WorkspaceAccessService, never from the request body.
   */
  buildWhere(query: QueryEntriesDto, scope: WorkspaceScope): Prisma.MoiEntryWhereInput {
    const where: Prisma.MoiEntryWhereInput = {
      ...this.access.eventFilter(scope, query.eventId),
    };

    if (query.status?.length) where.paymentStatus = { in: query.status };
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;

    if (query.minAmountPaise !== undefined || query.maxAmountPaise !== undefined) {
      where.amountPaise = {
        gte: query.minAmountPaise,
        lte: query.maxAmountPaise,
      };
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
        lte: query.dateTo ? new Date(query.dateTo) : undefined,
      };
    }

    if (query.q) {
      const term = query.q;
      const normalizedRef = normalizeReference(term);
      where.OR = [
        { guestName: { contains: term, mode: 'insensitive' } },
        { guestAddress: { contains: term, mode: 'insensitive' } },
        { guestPhone: { contains: term.replace(/\D/g, '') || term } },
        { entryCode: { contains: term.toUpperCase() } },
        ...(normalizedRef
          ? [
              {
                paymentClaims: {
                  some: { utrNormalized: { contains: normalizedRef } },
                },
              } as Prisma.MoiEntryWhereInput,
            ]
          : []),
      ];
    }

    return where;
  }

  async list(query: QueryEntriesDto, scope: WorkspaceScope) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where = this.buildWhere(query, scope);

    const [total, rows, aggregate] = await Promise.all([
      this.prisma.moiEntry.count({ where }),
      this.prisma.moiEntry.findMany({
        where,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortDir ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          event: { select: { id: true, name: true, slug: true, eventDate: true } },
          paymentClaims: {
            orderBy: { createdAt: 'desc' },
            take: 3,
            select: { utr: true, status: true, createdAt: true },
          },
          bankTransactions: {
            select: { id: true, txnDate: true, reference: true, amountPaise: true },
          },
        },
      }),
      this.prisma.moiEntry.aggregate({ where, _sum: { amountPaise: true } }),
    ]);

    return {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      filteredSumPaise: aggregate._sum.amountPaise ?? 0,
      rows,
    };
  }

  async stats(scope: WorkspaceScope, eventId?: string) {
    const where: Prisma.MoiEntryWhereInput = this.access.eventFilter(scope, eventId);

    const [grouped, methodGrouped, totals, topEntries] = await Promise.all([
      this.prisma.moiEntry.groupBy({
        by: ['paymentStatus'],
        where,
        _count: { _all: true },
        _sum: { amountPaise: true },
      }),
      this.prisma.moiEntry.groupBy({
        by: ['paymentMethod'],
        where,
        _count: { _all: true },
        _sum: { amountPaise: true },
      }),
      this.prisma.moiEntry.aggregate({
        where,
        _count: { _all: true },
        _sum: { amountPaise: true },
      }),
      this.prisma.moiEntry.findMany({
        where,
        orderBy: { amountPaise: 'desc' },
        take: 5,
        select: { entryCode: true, guestName: true, amountPaise: true, paymentStatus: true },
      }),
    ]);

    const byStatus = Object.fromEntries(
      grouped.map((row) => [
        row.paymentStatus,
        { count: row._count._all, sumPaise: row._sum.amountPaise ?? 0 },
      ]),
    );

    return {
      totalEntries: totals._count._all,
      // Submitted is what guests claimed; verified is what the bank confirms.
      submittedPaise: totals._sum.amountPaise ?? 0,
      verifiedPaise: byStatus.VERIFIED?.sumPaise ?? 0,
      verifiedCount: byStatus.VERIFIED?.count ?? 0,
      awaitingCount: byStatus.AWAITING_VERIFICATION?.count ?? 0,
      awaitingPaise: byStatus.AWAITING_VERIFICATION?.sumPaise ?? 0,
      reviewCount: byStatus.REVIEW_REQUIRED?.count ?? 0,
      notFoundCount: byStatus.NOT_FOUND?.count ?? 0,
      rejectedCount: byStatus.REJECTED?.count ?? 0,
      byStatus,
      byMethod: Object.fromEntries(
        methodGrouped.map((row) => [
          row.paymentMethod,
          { count: row._count._all, sumPaise: row._sum.amountPaise ?? 0 },
        ]),
      ),
      topEntries,
    };
  }

  async get(id: string) {
    const entry = await this.prisma.moiEntry.findUnique({
      where: { id },
      include: {
        event: true,
        paymentClaims: { orderBy: { createdAt: 'desc' } },
        bankTransactions: true,
        recordedByAdmin: { select: { id: true, name: true } },
        verifiedByAdmin: { select: { id: true, name: true } },
      },
    });
    if (!entry) throw new NotFoundException('Entry not found');

    return {
      ...entry,
      bankTransactions: entry.bankTransactions.map((txn) => ({
        ...txn,
        balancePaise: txn.balancePaise === null ? null : Number(txn.balancePaise),
      })),
    };
  }

  /**
   * Same guest name + amount inside the same event. Surfaced so the organizer
   * can decide; never auto-deleted.
   */
  async duplicates(eventId: string) {
    const groups = await this.prisma.moiEntry.groupBy({
      by: ['guestName', 'amountPaise'],
      where: { eventId },
      _count: { _all: true },
      having: { guestName: { _count: { gt: 1 } } },
    });

    if (!groups.length) return [];

    const entries = await this.prisma.moiEntry.findMany({
      where: {
        eventId,
        OR: groups.map((g) => ({ guestName: g.guestName, amountPaise: g.amountPaise })),
      },
      orderBy: [{ guestName: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        entryCode: true,
        guestName: true,
        guestPhone: true,
        amountPaise: true,
        paymentStatus: true,
        paymentMethod: true,
        createdAt: true,
      },
    });

    return groups.map((group) => ({
      guestName: group.guestName,
      amountPaise: group.amountPaise,
      count: group._count._all,
      entries: entries.filter(
        (e) => e.guestName === group.guestName && e.amountPaise === group.amountPaise,
      ),
    }));
  }

  async createManual(dto: CreateManualEntryDto, adminId: string, ip?: string) {
    const event = await this.prisma.event.findUnique({ where: { id: dto.eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const confirmCash = dto.paymentMethod === 'CASH' && dto.confirmReceived === true;
    const now = new Date();

    const entry = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.event.update({
        where: { id: event.id },
        data: { entrySequence: { increment: 1 } },
        select: { entrySequence: true },
      });
      const entryNumber = updated.entrySequence;

      return tx.moiEntry.create({
        data: {
          eventId: event.id,
          entryNumber,
          entryCode: buildEntryCode(entryNumber),
          guestName: dto.guestName,
          guestAddress: dto.guestAddress || null,
          guestPhone: normalizePhone(dto.guestPhone),
          relation: dto.relation || null,
          amountPaise: dto.amountPaise,
          paymentMethod: dto.paymentMethod,
          // Cash can be attested by the organizer; anything electronic still
          // has to be reconciled against the bank statement.
          paymentStatus: confirmCash ? 'VERIFIED' : 'AWAITING_VERIFICATION',
          verifiedAt: confirmCash ? now : null,
          verifiedByAdminId: confirmCash ? adminId : null,
          accessToken: generateAccessToken(),
          recordedByAdminId: adminId,
          note: dto.note || null,
        },
      });
    });

    await this.audit.record({
      adminUserId: adminId,
      action: confirmCash ? 'ENTRY_CREATED_CASH_CONFIRMED' : 'ENTRY_CREATED_BY_ADMIN',
      entityType: 'MoiEntry',
      entityId: entry.id,
      ip,
      metadata: {
        entryCode: entry.entryCode,
        amountPaise: entry.amountPaise,
        paymentMethod: entry.paymentMethod,
      },
    });

    return entry;
  }

  /** The organizer records a UTR a guest passed on by phone or message. */
  async addReference(id: string, dto: AdminSubmitReferenceDto, adminId: string, ip?: string) {
    const normalized = normalizeReference(dto.utr);
    if (!normalized) throw new BadRequestException('Reference is not valid');

    const entry = await this.prisma.moiEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Entry not found');

    const clash = await this.prisma.paymentClaim.findUnique({
      where: { utrNormalized: normalized },
      select: { entryId: true },
    });
    if (clash && clash.entryId !== id) {
      throw new ConflictException('That reference is already recorded against another entry');
    }

    if (!clash) {
      await this.prisma.paymentClaim.create({
        data: {
          entryId: id,
          utr: dto.utr,
          utrNormalized: normalized,
          source: 'ADMIN',
          status: 'CLAIMED',
        },
      });
    }

    await this.audit.record({
      adminUserId: adminId,
      action: 'PAYMENT_REFERENCE_CLAIMED',
      entityType: 'MoiEntry',
      entityId: id,
      ip,
      metadata: { utrNormalized: normalized, source: 'ADMIN' },
    });

    return this.reconciliation.matchEntry(id, {}, adminId);
  }

  async review(id: string, dto: ReviewEntryDto, adminId: string, ip?: string) {
    const entry = await this.prisma.moiEntry.findUnique({
      where: { id },
      include: { paymentClaims: { where: { status: 'CLAIMED' }, orderBy: { createdAt: 'desc' } } },
    });
    if (!entry) throw new NotFoundException('Entry not found');

    if (dto.action === 'MATCH_TRANSACTION') {
      if (!dto.bankTransactionId) {
        throw new BadRequestException('bankTransactionId is required to match a transaction');
      }

      const txn = await this.prisma.bankTransaction.findUnique({
        where: { id: dto.bankTransactionId },
      });
      if (!txn) throw new NotFoundException('Bank transaction not found');
      if (txn.direction !== 'CREDIT') {
        throw new BadRequestException('Only an incoming credit can verify a contribution');
      }
      if (txn.matchedEntryId && txn.matchedEntryId !== id) {
        throw new ConflictException('That bank transaction is already matched to another entry');
      }
      if (txn.amountPaise !== entry.amountPaise) {
        throw new BadRequestException(
          'The credited amount does not equal the recorded contribution. Correct the entry amount first.',
        );
      }

      return this.reconciliation.applyMatch(
        entry.id,
        entry.entryCode,
        txn.id,
        entry.paymentStatus,
        {
          reason: dto.reason,
          claimId: entry.paymentClaims[0]?.id,
          actorAdminId: adminId,
          manual: true,
        },
      );
    }

    if (dto.action === 'CONFIRM_CASH') {
      if (entry.paymentMethod !== 'CASH') {
        throw new BadRequestException('Only a cash entry can be confirmed this way');
      }
      const now = new Date();
      await this.prisma.moiEntry.update({
        where: { id },
        data: {
          paymentStatus: 'VERIFIED',
          verifiedAt: now,
          verifiedByAdminId: adminId,
          reviewReason: dto.reason,
        },
      });
      await this.audit.record({
        adminUserId: adminId,
        action: 'ENTRY_CASH_CONFIRMED',
        entityType: 'MoiEntry',
        entityId: id,
        ip,
        metadata: { reason: dto.reason, previousStatus: entry.paymentStatus },
      });
      return this.get(id);
    }

    const nextStatus = dto.action === 'REJECT' ? 'REJECTED' : 'AWAITING_VERIFICATION';

    await this.prisma.$transaction(async (tx) => {
      // Releasing a rejected/reset entry frees its bank transaction for reuse.
      await tx.bankTransaction.updateMany({
        where: { matchedEntryId: id },
        data: { matchedEntryId: null, matchedAt: null, matchNote: 'Unlinked: ' + dto.reason },
      });
      await tx.paymentClaim.updateMany({
        where: { entryId: id, status: 'MATCHED' },
        data: { status: 'CLAIMED', matchedBankTransactionId: null, matchedAt: null },
      });
      await tx.moiEntry.update({
        where: { id },
        data: {
          paymentStatus: nextStatus,
          verifiedAt: null,
          verifiedByAdminId: null,
          reviewReason: dto.reason,
        },
      });
    });

    await this.audit.record({
      adminUserId: adminId,
      action: dto.action === 'REJECT' ? 'ENTRY_REJECTED' : 'ENTRY_RESET',
      entityType: 'MoiEntry',
      entityId: id,
      ip,
      metadata: { reason: dto.reason, previousStatus: entry.paymentStatus },
    });

    return this.get(id);
  }
}
