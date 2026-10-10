import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { parseAmountToPaise } from '../../common/utils/money.util';
import { normalizeReference } from '../../common/utils/normalize.util';

export interface ParsedTransaction {
  txnDate: Date;
  valueDate: Date | null;
  description: string;
  reference: string | null;
  refNormalized: string | null;
  amountPaise: number;
  direction: 'CREDIT' | 'DEBIT';
  balancePaise: bigint | null;
  /** 1-based row number in the source file, for error reporting. */
  sourceRow: number;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  totalRows: number;
  skipped: { row: number; reason: string }[];
  detectedColumns: Record<string, number>;
}

/** Header synonyms seen across Indian bank statement exports. */
const COLUMN_PATTERNS: Record<string, RegExp> = {
  txnDate: /^(txn|transaction|tran|value|post|book)?\s*[._-]?\s*(date|dt)$|^date$/i,
  valueDate: /value\s*date|val\s*dt/i,
  description: /narration|description|particular|remark|details|transaction\s*remarks|narrative/i,
  reference: /(ref|reference|utr|rrn|cheque|chq|instrument)\s*(no|number|id)?\.?$|^ref$|^utr$/i,
  debit: /^(debit|withdrawal|withdrawl|dr)(\s*(amt|amount))?\.?$|withdrawal\s*amt/i,
  credit: /^(credit|deposit|cr)(\s*(amt|amount))?\.?$|deposit\s*amt/i,
  amount: /^(amount|amt|transaction\s*amount)$/i,
  drCr: /^(dr\s*\/?\s*cr|type|cr\s*\/?\s*dr|indicator)$/i,
  balance: /balance|closing\s*bal/i,
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

@Injectable()
export class StatementParserService {
  private readonly logger = new Logger(StatementParserService.name);

  async parse(file: { buffer: Buffer; originalname: string; mimetype?: string }): Promise<ParseResult> {
    const isCsv =
      /\.csv$/i.test(file.originalname) ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/csv';

    const rows = isCsv ? await this.readCsv(file.buffer) : await this.readXlsx(file.buffer);
    if (!rows.length) throw new BadRequestException('The statement file is empty');

    return this.rowsToTransactions(rows);
  }

  private async readXlsx(buffer: Buffer): Promise<unknown[][]> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch {
      throw new BadRequestException('Could not read that file as XLSX. Try exporting it as CSV.');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('The workbook has no sheets');

    const rows: unknown[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as unknown[];
      // ExcelJS pads index 0; drop it so columns are 0-based.
      rows.push(values.slice(1).map((cell) => this.cellValue(cell)));
    });
    return rows;
  }

  private async readCsv(buffer: Buffer): Promise<unknown[][]> {
    const workbook = new ExcelJS.Workbook();
    const stream = Readable.from(buffer.toString('utf8'));
    const sheet = await workbook.csv.read(stream);
    const rows: unknown[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as unknown[];
      rows.push(values.slice(1).map((cell) => this.cellValue(cell)));
    });
    return rows;
  }

  private cellValue(cell: unknown): unknown {
    if (cell === null || cell === undefined) return null;
    if (cell instanceof Date) return cell;
    if (typeof cell === 'object') {
      const anyCell = cell as any;
      if (anyCell.text !== undefined) return anyCell.text;
      if (anyCell.result !== undefined) return anyCell.result;
      if (anyCell.richText) return anyCell.richText.map((r: any) => r.text).join('');
      return String(cell);
    }
    return cell;
  }

  /**
   * Bank exports usually carry a few account-summary lines above the real
   * header, so the header row is located by scoring the first 30 rows.
   */
  private findHeaderRow(rows: unknown[][]): { index: number; columns: Record<string, number> } {
    let best = { index: -1, columns: {} as Record<string, number>, score: 0 };

    for (let i = 0; i < Math.min(rows.length, 30); i += 1) {
      const columns: Record<string, number> = {};
      rows[i].forEach((cell, colIndex) => {
        const text = String(cell ?? '').trim();
        if (!text) return;
        for (const [key, pattern] of Object.entries(COLUMN_PATTERNS)) {
          if (columns[key] === undefined && pattern.test(text)) {
            columns[key] = colIndex;
          }
        }
      });

      const hasDate = columns.txnDate !== undefined;
      const hasAmount =
        columns.credit !== undefined || columns.debit !== undefined || columns.amount !== undefined;
      const score = Object.keys(columns).length + (hasDate ? 3 : 0) + (hasAmount ? 3 : 0);

      if (hasDate && hasAmount && score > best.score) {
        best = { index: i, columns, score };
      }
    }

    if (best.index === -1) {
      throw new BadRequestException(
        'Could not find a header row with a date column and a credit/debit or amount column. Supported headers include Date, Narration/Description, Ref No/UTR, Withdrawal/Debit, Deposit/Credit, Balance.',
      );
    }

    return { index: best.index, columns: best.columns };
  }

  private rowsToTransactions(rows: unknown[][]): ParseResult {
    const { index: headerIndex, columns } = this.findHeaderRow(rows);
    const transactions: ParsedTransaction[] = [];
    const skipped: { row: number; reason: string }[] = [];

    for (let i = headerIndex + 1; i < rows.length; i += 1) {
      const row = rows[i];
      const sourceRow = i + 1;
      const at = (key: string): unknown =>
        columns[key] === undefined ? null : row[columns[key]] ?? null;

      if (row.every((cell) => cell === null || String(cell).trim() === '')) continue;

      const txnDate = this.parseDate(at('txnDate'));
      if (!txnDate) {
        skipped.push({ row: sourceRow, reason: 'Unreadable or missing transaction date' });
        continue;
      }

      let amountPaise: number | null = null;
      let direction: 'CREDIT' | 'DEBIT' | null = null;

      const creditPaise = parseAmountToPaise(at('credit'));
      const debitPaise = parseAmountToPaise(at('debit'));

      if (creditPaise && creditPaise !== 0) {
        amountPaise = Math.abs(creditPaise);
        direction = 'CREDIT';
      } else if (debitPaise && debitPaise !== 0) {
        amountPaise = Math.abs(debitPaise);
        direction = 'DEBIT';
      } else {
        const single = parseAmountToPaise(at('amount'));
        if (single !== null && single !== 0) {
          amountPaise = Math.abs(single);
          const indicator = String(at('drCr') ?? '').trim().toUpperCase();
          if (indicator.startsWith('C')) direction = 'CREDIT';
          else if (indicator.startsWith('D')) direction = 'DEBIT';
          else direction = single > 0 ? 'CREDIT' : 'DEBIT';
        }
      }

      if (amountPaise === null || direction === null) {
        skipped.push({ row: sourceRow, reason: 'No usable credit, debit or amount value' });
        continue;
      }

      const description = String(at('description') ?? '').trim();
      const rawReference = at('reference');
      const reference = rawReference === null ? null : String(rawReference).trim() || null;

      transactions.push({
        txnDate,
        valueDate: this.parseDate(at('valueDate')),
        description,
        reference,
        // Fall back to the narration, which is where UPI UTRs usually live.
        refNormalized: normalizeReference(reference) ?? normalizeReference(description),
        amountPaise,
        direction,
        balancePaise: this.toBigIntPaise(at('balance')),
        sourceRow,
      });
    }

    return {
      transactions,
      totalRows: Math.max(0, rows.length - headerIndex - 1),
      skipped,
      detectedColumns: columns,
    };
  }

  private toBigIntPaise(value: unknown): bigint | null {
    const paise = parseAmountToPaise(value);
    return paise === null ? null : BigInt(paise);
  }

  /** Handles Excel dates plus dd/mm/yyyy, dd-mm-yy, dd-MMM-yyyy and ISO strings. */
  private parseDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

    if (typeof value === 'number') {
      // Excel serial date (1900 system).
      const ms = Math.round((value - 25569) * 86400 * 1000);
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const text = String(value).trim();
    if (!text) return null;

    const dmy = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (dmy) {
      const day = Number(dmy[1]);
      const month = Number(dmy[2]) - 1;
      let year = Number(dmy[3]);
      if (year < 100) year += year > 70 ? 1900 : 2000;
      // Indian statements are day-first; swap when the first part cannot be a day.
      if (day > 31) return null;
      if (month > 11) return null;
      const date = new Date(Date.UTC(year, month, day));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const dMonY = text.match(/^(\d{1,2})[\-\s]([A-Za-z]{3,})[\-\s](\d{2,4})/);
    if (dMonY) {
      const month = MONTHS[dMonY[2].slice(0, 3).toLowerCase()];
      if (month === undefined) return null;
      let year = Number(dMonY[3]);
      if (year < 100) year += year > 70 ? 1900 : 2000;
      const date = new Date(Date.UTC(year, month, Number(dMonY[1])));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const fallback = new Date(text);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
}
