import { Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminEntriesService } from '../admin-entries/admin-entries.service';
import { QueryEntriesDto } from '../admin-entries/dto/query-entries.dto';
import { formatInr } from '../../common/utils/money.util';

const STATUS_LABEL: Record<string, string> = {
  AWAITING_VERIFICATION: 'Awaiting verification',
  VERIFIED: 'Verified',
  REVIEW_REQUIRED: 'Needs review',
  NOT_FOUND: 'Not found in statement',
  REJECTED: 'Rejected',
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminEntries: AdminEntriesService,
  ) {}

  private async loadReportData(query: QueryEntriesDto) {
    const where = this.adminEntries.buildWhere(query);

    const [entries, event] = await Promise.all([
      this.prisma.moiEntry.findMany({
        where,
        orderBy: [{ eventId: 'asc' }, { entryNumber: 'asc' }],
        include: {
          event: { select: { name: true, eventDate: true, venue: true, hostName: true } },
          paymentClaims: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { utr: true, status: true },
          },
        },
      }),
      query.eventId
        ? this.prisma.event.findUnique({ where: { id: query.eventId } })
        : Promise.resolve(null),
    ]);

    if (query.eventId && !event) throw new NotFoundException('Event not found');

    // Totals are computed over the same filtered set the rows come from, so
    // the report footer can never disagree with its own table.
    const verified = entries.filter((e) => e.paymentStatus === 'VERIFIED');
    const pending = entries.filter((e) =>
      ['AWAITING_VERIFICATION', 'REVIEW_REQUIRED', 'NOT_FOUND'].includes(e.paymentStatus),
    );
    const rejected = entries.filter((e) => e.paymentStatus === 'REJECTED');
    const sum = (rows: typeof entries) => rows.reduce((acc, e) => acc + e.amountPaise, 0);

    return {
      event,
      entries,
      totals: {
        entryCount: entries.length,
        submittedPaise: sum(entries),
        verifiedCount: verified.length,
        verifiedPaise: sum(verified),
        pendingCount: pending.length,
        pendingPaise: sum(pending),
        rejectedCount: rejected.length,
        rejectedPaise: sum(rejected),
      },
      generatedAt: new Date(),
    };
  }

  async buildExcel(query: QueryEntriesDto): Promise<{ buffer: Buffer; filename: string }> {
    const data = await this.loadReportData(query);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MoiLedger';
    workbook.created = data.generatedAt;

    // --- Summary sheet ------------------------------------------------------
    const summary = workbook.addWorksheet('Summary');
    summary.columns = [
      { header: 'Field', key: 'field', width: 32 },
      { header: 'Value', key: 'value', width: 42 },
    ];
    const rows: [string, string][] = [
      ['Event', data.event?.name ?? 'All events'],
      ['Host', data.event?.hostName ?? '-'],
      ['Event date', data.event ? data.event.eventDate.toISOString().slice(0, 10) : '-'],
      ['Venue', data.event?.venue ?? '-'],
      ['Report generated', data.generatedAt.toISOString()],
      ['Total entries', String(data.totals.entryCount)],
      ['Verified entries', String(data.totals.verifiedCount)],
      ['Verified total', formatInr(data.totals.verifiedPaise)],
      ['Pending entries', String(data.totals.pendingCount)],
      ['Pending total (unverified)', formatInr(data.totals.pendingPaise)],
      ['Rejected entries', String(data.totals.rejectedCount)],
      ['Submitted total (all statuses)', formatInr(data.totals.submittedPaise)],
    ];
    rows.forEach(([field, value]) => summary.addRow({ field, value }));
    summary.getRow(1).font = { bold: true };
    summary.getColumn('field').font = { bold: false };
    summary.addRow({});
    summary.addRow({
      field: 'Note',
      value: 'Only the verified total is confirmed against bank records.',
    });

    // --- Register sheet -----------------------------------------------------
    const sheet = workbook.addWorksheet('Moi Register');
    sheet.columns = [
      { header: 'Entry code', key: 'entryCode', width: 14 },
      { header: 'Guest name', key: 'guestName', width: 26 },
      { header: 'Address', key: 'guestAddress', width: 28 },
      { header: 'Phone', key: 'guestPhone', width: 14 },
      { header: 'Relation', key: 'relation', width: 14 },
      { header: 'Amount (INR)', key: 'amount', width: 14, style: { numFmt: '#,##0.00' } },
      { header: 'Method', key: 'paymentMethod', width: 12 },
      { header: 'Status', key: 'status', width: 22 },
      { header: 'UPI reference', key: 'utr', width: 24 },
      { header: 'Verified at', key: 'verifiedAt', width: 20 },
      { header: 'Recorded at', key: 'createdAt', width: 20 },
      { header: 'Event', key: 'eventName', width: 24 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    data.entries.forEach((entry) => {
      sheet.addRow({
        entryCode: entry.entryCode,
        guestName: entry.guestName,
        guestAddress: entry.guestAddress ?? '',
        guestPhone: entry.guestPhone ?? '',
        relation: entry.relation ?? '',
        amount: entry.amountPaise / 100,
        paymentMethod: entry.paymentMethod,
        status: STATUS_LABEL[entry.paymentStatus] ?? entry.paymentStatus,
        utr: entry.paymentClaims[0]?.utr ?? '',
        verifiedAt: entry.verifiedAt ? entry.verifiedAt.toISOString() : '',
        createdAt: entry.createdAt.toISOString(),
        eventName: entry.event.name,
      });
    });

    const totalRow = sheet.addRow({
      guestName: 'TOTAL (' + data.totals.entryCount + ' entries)',
      amount: data.totals.submittedPaise / 100,
    });
    totalRow.font = { bold: true };
    const verifiedRow = sheet.addRow({
      guestName: 'VERIFIED TOTAL (' + data.totals.verifiedCount + ' entries)',
      amount: data.totals.verifiedPaise / 100,
    });
    verifiedRow.font = { bold: true };

    sheet.autoFilter = { from: 'A1', to: 'L1' };

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, filename: this.filename(data.event?.name, 'xlsx') };
  }

  async buildPdf(query: QueryEntriesDto): Promise<{ buffer: Buffer; filename: string }> {
    const data = await this.loadReportData(query);

    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    // --- Header -------------------------------------------------------------
    doc.fontSize(18).text('Moi Register', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(13).text(data.event?.name ?? 'All events', { align: 'center' });
    doc.fontSize(9).fillColor('#555');
    const metaBits = [
      data.event?.hostName ? 'Host: ' + data.event.hostName : null,
      data.event ? 'Date: ' + data.event.eventDate.toISOString().slice(0, 10) : null,
      data.event?.venue ? 'Venue: ' + data.event.venue : null,
    ].filter(Boolean);
    if (metaBits.length) doc.text(metaBits.join('   |   '), { align: 'center' });
    doc.text('Generated: ' + data.generatedAt.toISOString().replace('T', ' ').slice(0, 19), {
      align: 'center',
    });
    doc.fillColor('#000').moveDown(1);

    // --- Summary box --------------------------------------------------------
    const summaryLines = [
      ['Total entries', String(data.totals.entryCount)],
      ['Verified', data.totals.verifiedCount + '  ' + formatInr(data.totals.verifiedPaise)],
      ['Pending / unverified', data.totals.pendingCount + '  ' + formatInr(data.totals.pendingPaise)],
      ['Rejected', data.totals.rejectedCount + '  ' + formatInr(data.totals.rejectedPaise)],
      ['Submitted total', formatInr(data.totals.submittedPaise)],
    ];
    doc.fontSize(10);
    summaryLines.forEach(([label, value]) => {
      doc.text(label.padEnd(26, ' ') + value);
    });
    doc.moveDown(0.5);
    doc
      .fontSize(8)
      .fillColor('#8a5a00')
      .text(
        'Only the verified total is confirmed against bank records. Pending amounts are guest claims that are not yet matched.',
      );
    doc.fillColor('#000').moveDown(1);

    // --- Table --------------------------------------------------------------
    const columns = [
      { label: 'Code', width: 62 },
      { label: 'Guest', width: 120 },
      { label: 'Address', width: 110 },
      { label: 'Amount', width: 62, align: 'right' as const },
      { label: 'Method', width: 46 },
      { label: 'Status', width: 84 },
      { label: 'Reference', width: 90 },
    ];

    const drawHeader = () => {
      doc.fontSize(8).font('Helvetica-Bold');
      let x = doc.page.margins.left;
      const y = doc.y;
      columns.forEach((col) => {
        doc.text(col.label, x, y, { width: col.width, align: col.align ?? 'left' });
        x += col.width;
      });
      doc.moveTo(doc.page.margins.left, doc.y + 2)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
        .strokeColor('#999')
        .stroke();
      doc.moveDown(0.4);
      doc.font('Helvetica');
    };

    drawHeader();

    data.entries.forEach((entry) => {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      let x = doc.page.margins.left;
      const cells = [
        entry.entryCode,
        entry.guestName,
        entry.guestAddress ?? '-',
        formatInr(entry.amountPaise),
        entry.paymentMethod,
        STATUS_LABEL[entry.paymentStatus] ?? entry.paymentStatus,
        entry.paymentClaims[0]?.utr ?? '-',
      ];
      let maxHeight = 0;
      cells.forEach((cell, index) => {
        const col = columns[index];
        const height = doc.heightOfString(String(cell), { width: col.width - 4 });
        maxHeight = Math.max(maxHeight, height);
        doc.fontSize(8).text(String(cell), x, y, {
          width: col.width - 4,
          align: col.align ?? 'left',
        });
        x += col.width;
      });
      doc.y = y + maxHeight + 3;
    });

    doc.moveDown(0.6);
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(
        'Verified total: ' +
          formatInr(data.totals.verifiedPaise) +
          '    |    Submitted total: ' +
          formatInr(data.totals.submittedPaise),
      );
    doc.font('Helvetica').fontSize(7).fillColor('#666').moveDown(0.4);
    doc.text(
      'Confidential: this register contains guest personal information and is for authorized organizers only.',
    );

    doc.end();
    const buffer = await done;
    return { buffer, filename: this.filename(data.event?.name, 'pdf') };
  }

  private filename(eventName: string | undefined, ext: string): string {
    const base = (eventName ?? 'all-events')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    return 'moi-register-' + base + '-' + new Date().toISOString().slice(0, 10) + '.' + ext;
  }
}
