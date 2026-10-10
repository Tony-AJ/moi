import { useCallback, useEffect, useState } from 'react';
import {
  api,
  formatDateTime,
  formatInr,
  STATUS_LABEL,
  type BankTransactionRow,
  type EntryRow,
} from '../lib/api';

export function EntryDetailModal({
  entryId,
  onClose,
  onChanged,
}: {
  entryId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [entry, setEntry] = useState<EntryRow | null>(null);
  const [candidates, setCandidates] = useState<BankTransactionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [utr, setUtr] = useState('');

  const load = useCallback(async () => {
    try {
      const [detail, options] = await Promise.all([
        api.entry(entryId),
        api.candidates(entryId).catch(() => [] as BankTransactionRow[]),
      ]);
      setEntry(detail);
      setCandidates(options);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the entry');
    }
  }, [entryId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await load();
      onChanged();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  const requireReason = (): boolean => {
    if (reason.trim().length < 3) {
      setError('Enter a short reason so the decision stays auditable.');
      return false;
    }
    return true;
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(domEvent) => domEvent.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 style={{ marginBottom: 2 }}>
              {entry ? entry.entryCode + ' — ' + entry.guestName : 'Entry'}
            </h2>
            {entry ? (
              <span className={'badge ' + entry.paymentStatus}>
                {STATUS_LABEL[entry.paymentStatus]}
              </span>
            ) : null}
          </div>
          <button className="btn secondary small" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        {error ? <div className="alert err">{error}</div> : null}
        {notice ? <div className="alert ok">{notice}</div> : null}

        {!entry ? (
          <div className="spinner" />
        ) : (
          <>
            <dl className="kv">
              <dt>Amount</dt>
              <dd>
                <strong>{formatInr(entry.amountPaise)}</strong>
              </dd>
              <dt>Event</dt>
              <dd>{entry.event.name}</dd>
              <dt>Place</dt>
              <dd>{entry.guestAddress ?? '-'}</dd>
              <dt>Phone</dt>
              <dd>{entry.guestPhone ?? '-'}</dd>
              <dt>Method</dt>
              <dd>{entry.paymentMethod}</dd>
              <dt>Recorded</dt>
              <dd>{formatDateTime(entry.createdAt)}</dd>
              <dt>Verified</dt>
              <dd>{formatDateTime(entry.verifiedAt)}</dd>
              <dt>Last reconciled</dt>
              <dd>{formatDateTime(entry.lastReconciledAt)}</dd>
              <dt>Reason / note</dt>
              <dd>{entry.reviewReason ?? entry.note ?? '-'}</dd>
              <dt>Claimed references</dt>
              <dd>
                {entry.paymentClaims.length
                  ? entry.paymentClaims.map((claim) => (
                      <div key={claim.utr} className="mono">
                        {claim.utr} <span className="badge neutral">{claim.status}</span>
                      </div>
                    ))
                  : 'None'}
              </dd>
              <dt>Matched bank credits</dt>
              <dd>
                {entry.bankTransactions.length
                  ? entry.bankTransactions.map((txn) => (
                      <div key={txn.id} className="mono">
                        {formatDateTime(txn.txnDate)} · {formatInr(txn.amountPaise)} ·{' '}
                        {txn.reference ?? '-'}
                      </div>
                    ))
                  : 'None'}
              </dd>
            </dl>

            <div className="panel">
              <h2>Add a reference the guest gave you</h2>
              <div className="toolbar">
                <div className="grow">
                  <label htmlFor="admin-utr">UPI reference / UTR</label>
                  <input
                    id="admin-utr"
                    value={utr}
                    onChange={(domEvent) => setUtr(domEvent.target.value)}
                    placeholder="412345678901"
                  />
                </div>
                <button
                  className="btn"
                  type="button"
                  disabled={busy || utr.trim().length < 6}
                  onClick={() =>
                    act(
                      () => api.addReference(entry.id, utr.trim()),
                      'Reference saved and matching re-run.',
                    )
                  }
                >
                  Save &amp; match
                </button>
              </div>
            </div>

            <div className="panel">
              <h2>Decision</h2>
              <div className="field">
                <label htmlFor="reason">Reason (recorded in the audit log)</label>
                <input
                  id="reason"
                  value={reason}
                  onChange={(domEvent) => setReason(domEvent.target.value)}
                  placeholder="e.g. Confirmed with the bank passbook"
                />
              </div>
              <div className="row-actions">
                <button
                  className="btn secondary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => api.runReconciliationForEntry(entry.id),
                      'Matching re-run for this entry.',
                    )
                  }
                >
                  Re-run matching
                </button>
                {entry.paymentMethod === 'CASH' && entry.paymentStatus !== 'VERIFIED' ? (
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      requireReason() &&
                      act(
                        () =>
                          api.review(entry.id, { action: 'CONFIRM_CASH', reason: reason.trim() }),
                        'Cash confirmed as received.',
                      )
                    }
                  >
                    Confirm cash received
                  </button>
                ) : null}
                <button
                  className="btn secondary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    requireReason() &&
                    act(
                      () => api.review(entry.id, { action: 'RESET', reason: reason.trim() }),
                      'Entry reset to awaiting verification.',
                    )
                  }
                >
                  Reset to pending
                </button>
                <button
                  className="btn danger"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    requireReason() &&
                    act(
                      () => api.review(entry.id, { action: 'REJECT', reason: reason.trim() }),
                      'Entry marked as not received.',
                    )
                  }
                >
                  Mark not received
                </button>
              </div>
              {entry.paymentMethod !== 'CASH' ? (
                <p className="muted" style={{ marginTop: 10 }}>
                  A UPI entry can only be verified by linking a real incoming bank credit below.
                </p>
              ) : null}
            </div>

            {entry.paymentStatus !== 'VERIFIED' && entry.paymentMethod !== 'CASH' ? (
              <div className="panel">
                <h2>Candidate bank credits</h2>
                {!candidates.length ? (
                  <p className="muted">
                    No unmatched credits found near this entry&apos;s date and amount. Import a
                    newer statement and try again.
                  </p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th className="num">Amount</th>
                          <th>Reference</th>
                          <th>Narration</th>
                          <th>Match</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {candidates.map((txn) => (
                          <tr key={txn.id}>
                            <td>{formatDateTime(txn.txnDate)}</td>
                            <td className="num">{formatInr(txn.amountPaise)}</td>
                            <td className="mono">{txn.reference ?? '-'}</td>
                            <td style={{ maxWidth: 220, fontSize: '0.8rem' }}>
                              {txn.description}
                            </td>
                            <td>
                              {txn.referenceMatches ? (
                                <span className="badge VERIFIED">Reference</span>
                              ) : null}
                              {txn.amountMatches ? (
                                <span className="badge neutral">Amount</span>
                              ) : null}
                            </td>
                            <td>
                              <button
                                className="btn small"
                                type="button"
                                disabled={busy || !txn.amountMatches}
                                title={
                                  txn.amountMatches
                                    ? 'Link this credit and verify'
                                    : 'The amount must equal the entry amount'
                                }
                                onClick={() =>
                                  requireReason() &&
                                  act(
                                    () =>
                                      api.review(entry.id, {
                                        action: 'MATCH_TRANSACTION',
                                        bankTransactionId: txn.id,
                                        reason: reason.trim(),
                                      }),
                                    'Linked and verified.',
                                  )
                                }
                              >
                                Link &amp; verify
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
