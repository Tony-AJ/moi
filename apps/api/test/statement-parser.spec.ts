import { StatementParserService } from '../src/modules/bank-statements/statement-parser.service';

const HDFC_STYLE = [
  'Statement of account',
  'Account No: XXXX1234',
  '',
  'Date,Narration,Chq/Ref No,Value Date,Withdrawal Amt,Deposit Amt,Closing Balance',
  '10/10/2026,UPI-ARUN KUMAR-412345678901,412345678901,10/10/2026,,1000.00,41000.00',
  '11/10/2026,ATM WDL SELF,,11/10/2026,2000.00,,39000.00',
  '12/10/2026,bad date row below,,,,,',
  'not-a-date,UPI-X,,,,500.00,',
].join('\n');

const SINGLE_AMOUNT_STYLE = [
  'Txn Date,Particulars,UTR,Amount,Dr/Cr,Balance',
  '12-Oct-2026,UPI RECEIVED,998877665544,2500.00,CR,43500.00',
  '13-Oct-2026,UPI SENT,112233445566,100.00,DR,43400.00',
].join('\n');

function file(content: string, name = 'statement.csv') {
  return { buffer: Buffer.from(content, 'utf8'), originalname: name, mimetype: 'text/csv' };
}

describe('StatementParserService', () => {
  const parser = new StatementParserService();

  it('finds the header row under a summary preamble and classifies direction', async () => {
    const result = await parser.parse(file(HDFC_STYLE));

    expect(result.transactions).toHaveLength(2);
    const [credit, debit] = result.transactions;
    expect(credit.direction).toBe('CREDIT');
    expect(credit.amountPaise).toBe(100000);
    expect(credit.refNormalized).toBe('412345678901');
    expect(debit.direction).toBe('DEBIT');
    expect(debit.amountPaise).toBe(200000);
  });

  it('reports unreadable rows instead of dropping them silently', async () => {
    const result = await parser.parse(file(HDFC_STYLE));
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.skipped[0].reason).toMatch(/date|amount/i);
  });

  it('handles a single amount column with a Dr/Cr indicator and dd-MMM-yyyy dates', async () => {
    const result = await parser.parse(file(SINGLE_AMOUNT_STYLE));

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].direction).toBe('CREDIT');
    expect(result.transactions[0].amountPaise).toBe(250000);
    expect(result.transactions[0].txnDate.toISOString().slice(0, 10)).toBe('2026-10-12');
    expect(result.transactions[1].direction).toBe('DEBIT');
  });

  it('falls back to the narration when there is no reference column', async () => {
    const result = await parser.parse(
      file(
        [
          'Date,Description,Credit',
          '10/10/2026,UPI/CR/412345678999/LAKSHMI/HDFC,2500.00',
        ].join('\n'),
      ),
    );

    expect(result.transactions[0].refNormalized).toContain('412345678999');
  });
});
