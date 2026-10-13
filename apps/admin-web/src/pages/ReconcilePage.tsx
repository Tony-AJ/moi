import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  api,
  formatDateTime,
  formatInr,
  type BankTransactionRow,
  type BeneficiaryAccount,
  type ImportResult,
  type Paginated,
  type ReconciliationSummary,
} from '../lib/api';
import { EventPicker, useEventScope } from '../lib/scope';

export function ReconcilePage() {
  const { selectedEventId, events, loading: eventsLoading } = useEventScope();
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [accounts, setAccounts] = useState<BeneficiaryAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [autoReconcile, setAutoReconcile] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateFileWarning, setDuplicateFileWarning] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [run, setRun] = useState<ReconciliationSummary | null>(null);

  const [transactions, setTransactions] = useState<Paginated<BankTransactionRow> | null>(null);
  const [matchedFilter, setMatchedFilter] = useState<'' | 'true' | 'false'>('');
  const [directionFilter, setDirectionFilter] = useState<'' | 'CREDIT' | 'DEBIT'>('CREDIT');
  const [page, setPage] = useState(1);
  const [imports, setImports] = useState<
    {
      id: string;
      fileName: string;
      importedRows: number;
      duplicateRows: number;
      skippedRows: number;
      createdAt: string;
      uploadedByAdmin: { name: string } | null;
    }[]
  >([]);

  const loadTransactions = useCallback(async () => {
    if (!selectedEventId) return;
    try {
      setTransactions(
        await api.transactions({
          eventId: selectedEventId,
          direction: directionFilter || undefined,
          matched: matchedFilter || undefined,
          page,
          pageSize: 25,
        }),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load transactions');
    }
  }, [selectedEventId, directionFilter, matchedFilter, page]);

  const loadImports = useCallback(async () => {
    if (!selectedEventId) return;
    try {
      setImports(await api.imports(selectedEventId));
    } catch {
      setImports([]);
    }
  }, [selectedEventId]);

  // The statement has to be attributed to an account before it can be
  // imported, so the list is loaded up front.
  useEffect(() => {
    void (async () => {
      try {
        const list = await api.beneficiaries();
        setAccounts(list);
        setAccountId((current) => {
          if (current && list.some((account) => account.id === current)) return current;
          return list.find((account) => account.status === 'CONFIRMED')?.id ?? '';
        });
      } catch {
        setAccounts([]);
      }
    })();
  }, []);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    void loadImports();
  }, [loadImports]);

  async function upload(force = false) {
    if (!file || !selectedEventId || !accountId) return;
    setBusy(true);
    setError(null);
    setDuplicateFileWarning(false);
    try {
      const uploadResult = await api.importStatement(
        file,
        accountId,
        selectedEventId,
        autoReconcile,
        force,
      );
      setResult(uploadResult);
      setRun(uploadResult.reconciliation);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await Promise.all([loadTransactions(), loadImports()]);
    } catch (uploadError) {
      if (uploadError instanceof ApiError && uploadError.status === 409) {
        setDuplicateFileWarning(true);
        setError(uploadError.message);
      } else {
        setError(uploadError instanceof Error ? uploadError.message : 'Import failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function rerun() {
    if (!selectedEventId) return;
    setBusy(true);
    setError(null);
    try {
      setRun(await api.runReconciliation(selectedEventId));
      await loadTransactions();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Reconciliation failed');
    } finally {
      setBusy(false);
    }
  }

  if (eventsLoading && !events.length) return <div className="spinner" />;
  if (!events.length) {
    return (
      <>
        <h1>Reconciliation</h1>
        <div className="alert info">Create an event first.</div>
      </>
    );
  }

  return (
    <>
      <h1>Bank statement reconciliation</h1>
      <p className="page-sub">
        Import your account statement (CSV or XLSX). Incoming credits are matched to claimed UPI
        references. Ambiguous matches are never auto-verified.
      </p>

      <div className="toolbar">
        <EventPicker />
      </div>

      {error ? <div className="alert err">{error}</div> : null}

      <div className="panel">
        <h2>Import a statement</h2>
        {accounts.length === 0 ? (
          <div className="alert warn">
            No payment account is configured yet. Add and confirm the UPI account that receives
            contributions on the Events &amp; QR page before importing a statement.
          </div>
        ) : null}

        <div className="toolbar">
          <div>
            <label htmlFor="account">Statement account</label>
            <select
              id="account"
              value={accountId}
              onChange={(domEvent) => setAccountId(domEvent.target.value)}
            >
              <option value="">Select the account this statement came from</option>
              {accounts
                .filter((account) => account.status !== 'DISABLED')
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label} ({account.upiId})
                    {account.status === 'CONFIRMED' ? '' : ' - unconfirmed'}
                  </option>
                ))}
            </select>
          </div>
          <div className="grow">
            <label htmlFor="statement">Statement file</label>
            <input
              id="statement"
              type="file"
              ref={fileInput}
              accept=".csv,.xlsx,.xls"
              onChange={(domEvent) => setFile(domEvent.target.files?.[0] ?? null)}
            />
          </div>
          <div>
            <label htmlFor="auto">After import</label>
            <select
              id="auto"
              value={autoReconcile ? 'yes' : 'no'}
              onChange={(domEvent) => setAutoReconcile(domEvent.target.value === 'yes')}
            >
              <option value="yes">Run matching immediately</option>
              <option value="no">Import only</option>
            </select>
          </div>
          <button
            className="btn"
            type="button"
            disabled={!file || !accountId || busy}
            onClick={() => upload()}
          >
            {busy ? 'Working...' : 'Import'}
          </button>
          <button className="btn secondary" type="button" disabled={busy} onClick={rerun}>
            Re-run matching
          </button>
        </div>

        {duplicateFileWarning ? (
          <div className="alert warn">
            This file was already imported, so nothing changed. Import it again only if you know the
            statement was re-issued.{' '}
            <button className="btn small" type="button" onClick={() => upload(true)}>
              Import anyway
            </button>
          </div>
        ) : null}

        <p className="muted">
          Recognised headers: Date, Narration/Description/Particulars, Ref No/Cheque No/UTR,
          Withdrawal/Debit, Deposit/Credit, Balance. Duplicate rows across overlapping statements
          are ignored automatically.
        </p>
      </div>

      {result ? (
        <div className="panel">
          <h2>Last import</h2>
          <div className="cards">
            <div className="stat">
              <div className="label">Imported rows</div>
              <div className="value">{result.summary.importedRows}</div>
              <div className="foot">of {result.summary.parsedRows} parsed</div>
            </div>
            <div className="stat warn">
              <div className="label">Duplicates ignored</div>
              <div className="value">{result.summary.duplicateRows}</div>
            </div>
            <div className="stat">
              <div className="label">Credits / debits</div>
              <div className="value">
                {result.summary.credits}/{result.summary.debits}
              </div>
            </div>
            <div className="stat warn">
              <div className="label">Unreadable rows</div>
              <div className="value">{result.summary.skippedRows}</div>
            </div>
          </div>
          {result.skipped.length ? (
            <details>
              <summary className="muted">Skipped row details</summary>
              <ul className="muted">
                {result.skipped.map((row) => (
                  <li key={row.row}>
                    Row {row.row}: {row.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {run ? (
        <div className="panel">
          <h2>Matching result</h2>
          <div className="cards">
            <div className="stat">
              <div className="label">Entries scanned</div>
              <div className="value">{run.scannedEntries}</div>
            </div>
            <div className="stat ok">
              <div className="label">Newly verified</div>
              <div className="value">{run.verified}</div>
            </div>
            <div className="stat review">
              <div className="label">Needs review</div>
              <div className="value">{run.reviewRequired}</div>
            </div>
            <div className="stat warn">
              <div className="label">Not found</div>
              <div className="value">{run.notFound}</div>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>Status</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {run.results
                  .filter((row) => row.changed)
                  .map((row) => (
                    <tr key={row.entryId}>
                      <td className="mono">{row.entryCode}</td>
                      <td>
                        <span className={'badge ' + row.status}>
                          {row.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="muted">{row.reason}</td>
                    </tr>
                  ))}
                {!run.results.some((row) => row.changed) ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No status changed in this run.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <h2>Imported transactions</h2>
        <div className="toolbar">
          <div>
            <label htmlFor="direction">Direction</label>
            <select
              id="direction"
              value={directionFilter}
              onChange={(domEvent) => {
                setPage(1);
                setDirectionFilter(domEvent.target.value as typeof directionFilter);
              }}
            >
              <option value="CREDIT">Credits only</option>
              <option value="DEBIT">Debits only</option>
              <option value="">All</option>
            </select>
          </div>
          <div>
            <label htmlFor="matched">Match state</label>
            <select
              id="matched"
              value={matchedFilter}
              onChange={(domEvent) => {
                setPage(1);
                setMatchedFilter(domEvent.target.value as typeof matchedFilter);
              }}
            >
              <option value="">All</option>
              <option value="false">Unmatched</option>
              <option value="true">Matched</option>
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Direction</th>
                <th className="num">Amount</th>
                <th>Reference</th>
                <th>Narration</th>
                <th>Matched entry</th>
              </tr>
            </thead>
            <tbody>
              {transactions?.rows.map((txn) => (
                <tr key={txn.id}>
                  <td>{formatDateTime(txn.txnDate)}</td>
                  <td>
                    <span className={'badge ' + (txn.direction === 'CREDIT' ? 'VERIFIED' : 'neutral')}>
                      {txn.direction}
                    </span>
                  </td>
                  <td className="num">{formatInr(txn.amountPaise)}</td>
                  <td className="mono">{txn.reference ?? '-'}</td>
                  <td style={{ maxWidth: 320, fontSize: '0.8rem' }}>{txn.description}</td>
                  <td className="mono">
                    {txn.matchedEntry
                      ? txn.matchedEntry.entryCode + ' · ' + txn.matchedEntry.guestName
                      : '-'}
                  </td>
                </tr>
              ))}
              {transactions && !transactions.rows.length ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No transactions imported for this event yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {transactions ? (
          <div className="pager">
            <span>{transactions.total} transactions</span>
            <button
              className="btn secondary small"
              type="button"
              disabled={transactions.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <span>
              Page {transactions.page} / {transactions.totalPages}
            </span>
            <button
              className="btn secondary small"
              type="button"
              disabled={transactions.page >= transactions.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>

      <div className="panel">
        <h2>Import history</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>File</th>
                <th className="num">Imported</th>
                <th className="num">Duplicates</th>
                <th className="num">Skipped</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td>{row.fileName}</td>
                  <td className="num">{row.importedRows}</td>
                  <td className="num">{row.duplicateRows}</td>
                  <td className="num">{row.skippedRows}</td>
                  <td>{row.uploadedByAdmin?.name ?? '-'}</td>
                </tr>
              ))}
              {!imports.length ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No statements imported yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
