import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StatementParserService } from './statement-parser.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { sha256 } from '../../common/utils/token.util';

export interface UploadOptions {
  /**
   * The account the statement was downloaded from. Required: an import has
   * to belong to a known account, because that is what decides which
   * contributions its credits are allowed to settle. One account may serve
   * several of the workspace's events, so this is deliberately not an event.
   */
  beneficiaryAccountId: string;
  eventId?: string;
  /** Run reconciliation for the event straight after a successful import. */
  autoReconcile?: boolean;
  /** Import again even though the same file hash was seen before. */
  force?: boolean;
}

@Injectable()
export class BankStatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: StatementParserService,
    private readonly reconciliation: ReconciliationService,
    private readonly audit: AuditService,
  ) {}

  async import(
    file: { buffer: Buffer; originalname: string; mimetype?: string; size: number },
    options: UploadOptions,
    adminId: string,
    ip?: string,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('No file uploaded');

    const fileHash = sha256(file.buffer);

    const account = await this.prisma.beneficiaryAccount.findUnique({
      where: { id: options.beneficiaryAccountId },
      select: { id: true, workspaceId: true, status: true, label: true },
    });
    if (!account) throw new BadRequestException('Payment account not found');
    if (account.status === 'DISABLED') {
      throw new BadRequestException('That payment account is disabled');
    }

    // Duplicate detection is scoped to the workspace, so the response can
    // never disclose that some other customer uploaded the same file.
    const previous = await this.prisma.bankStatementImport.findFirst({
      where: { fileHash, workspaceId: account.workspaceId },
    });
    if (previous && !options.force) {
      throw new ConflictException({
        message:
          'This exact statement file was already imported. Nothing was changed. Pass force=true to import it again.',
        previousImport: {
          id: previous.id,
          fileName: previous.fileName,
          importedRows: previous.importedRows,
          createdAt: previous.createdAt,
        },
      });
    }

    const parsed = await this.parser.parse(file);
    if (!parsed.transactions.length) {
      throw new BadRequestException(
        'No usable transactions were found in that file. Skipped rows: ' + parsed.skipped.length,
      );
    }

    if (options.eventId) {
      const event = await this.prisma.event.findUnique({
        where: { id: options.eventId },
        select: { id: true, workspaceId: true },
      });
      if (!event) throw new BadRequestException('Event not found');
      // An event from another workspace must not be attachable to this
      // import, whatever id the browser sent.
      if (event.workspaceId !== account.workspaceId) {
        throw new BadRequestException('That event does not belong to this payment account');
      }
    }

    // Row-level hash makes re-imports and overlapping date ranges idempotent.
    const rows = parsed.transactions.map((txn) => ({
      txnDate: txn.txnDate,
      valueDate: txn.valueDate,
      description: txn.description,
      reference: txn.reference,
      refNormalized: txn.refNormalized,
      amountPaise: txn.amountPaise,
      direction: txn.direction,
      balancePaise: txn.balancePaise,
      eventId: options.eventId ?? null,
      workspaceId: account.workspaceId,
      beneficiaryAccountId: account.id,
      rowHash: sha256(
        [
          txn.txnDate.toISOString().slice(0, 10),
          txn.amountPaise,
          txn.direction,
          txn.refNormalized ?? '',
          txn.description.toUpperCase().replace(/\s+/g, ' ').slice(0, 120),
        ].join('|'),
      ),
    }));

    // Drop in-file duplicates before hitting the unique index.
    const seen = new Set<string>();
    const deduped = rows.filter((row) => {
      if (seen.has(row.rowHash)) return false;
      seen.add(row.rowHash);
      return true;
    });
    const inFileDuplicates = rows.length - deduped.length;

    const importRecord = await this.prisma.bankStatementImport.create({
      data: {
        eventId: options.eventId ?? null,
        workspaceId: account.workspaceId,
        beneficiaryAccountId: account.id,
        fileName: file.originalname,
        fileHash: options.force && previous ? fileHash + ':' + Date.now() : fileHash,
        totalRows: parsed.totalRows,
        skippedRows: parsed.skipped.length,
        uploadedByAdminId: adminId,
      },
    });

    const created = await this.prisma.bankTransaction.createMany({
      data: deduped.map((row) => ({ ...row, importId: importRecord.id })),
      skipDuplicates: true,
    });

    const duplicateRows = deduped.length - created.count + inFileDuplicates;

    const updated = await this.prisma.bankStatementImport.update({
      where: { id: importRecord.id },
      data: { importedRows: created.count, duplicateRows },
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'BANK_STATEMENT_IMPORTED',
      entityType: 'BankStatementImport',
      entityId: importRecord.id,
      ip,
      metadata: {
        fileName: file.originalname,
        importedRows: created.count,
        duplicateRows,
        skippedRows: parsed.skipped.length,
        eventId: options.eventId ?? null,
      },
    });

    const reconciliation =
      options.autoReconcile && options.eventId
        ? await this.reconciliation.runForEvent(options.eventId, {}, adminId)
        : null;

    return {
      import: updated,
      detectedColumns: parsed.detectedColumns,
      summary: {
        parsedRows: parsed.transactions.length,
        importedRows: created.count,
        duplicateRows,
        skippedRows: parsed.skipped.length,
        credits: deduped.filter((r) => r.direction === 'CREDIT').length,
        debits: deduped.filter((r) => r.direction === 'DEBIT').length,
      },
      skipped: parsed.skipped.slice(0, 25),
      reconciliation,
    };
  }

  /**
   * Imports visible to the caller. The workspace filter is mandatory: with
   * no filter this previously returned every customer's imports.
   */
  async listImports(params: { workspaceId: string; eventId?: string }) {
    return this.prisma.bankStatementImport.findMany({
      where: {
        workspaceId: params.workspaceId,
        ...(params.eventId ? { eventId: params.eventId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedByAdmin: { select: { id: true, name: true } },
        _count: { select: { bankTransactions: true } },
      },
    });
  }

  async listTransactions(params: {
    /** Mandatory tenant filter; never derived from the query string. */
    workspaceId: string;
    eventId?: string;
    importId?: string;
    direction?: 'CREDIT' | 'DEBIT';
    matched?: 'true' | 'false';
    q?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Number(params.page ?? 1);
    const pageSize = Math.min(Number(params.pageSize ?? 50), 200);

    const where = {
      workspaceId: params.workspaceId,
      eventId: params.eventId,
      importId: params.importId,
      direction: params.direction,
      ...(params.matched === 'true' ? { NOT: { matchedEntryId: null } } : {}),
      ...(params.matched === 'false' ? { matchedEntryId: null } : {}),
      ...(params.q
        ? {
            OR: [
              { description: { contains: params.q, mode: 'insensitive' as const } },
              { reference: { contains: params.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.bankTransaction.count({ where }),
      this.prisma.bankTransaction.findMany({
        where,
        orderBy: { txnDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          matchedEntry: { select: { id: true, entryCode: true, guestName: true } },
        },
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      rows: rows.map((txn) => ({
        ...txn,
        balancePaise: txn.balancePaise === null ? null : Number(txn.balancePaise),
      })),
    };
  }
}
