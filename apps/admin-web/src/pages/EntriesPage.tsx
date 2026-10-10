import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  api,
  formatDateTime,
  formatInr,
  STATUS_LABEL,
  type EntryRow,
  type Paginated,
  type PaymentStatus,
} from '../lib/api';
import { EventPicker, useEventScope } from '../lib/scope';
import { EntryDetailModal } from '../components/EntryDetailModal';
import { ManualEntryModal } from '../components/ManualEntryModal';

const STATUSES: PaymentStatus[] = [
  'AWAITING_VERIFICATION',
  'VERIFIED',
  'REVIEW_REQUIRED',
  'NOT_FOUND',
  'REJECTED',
];

export function EntriesPage() {
  const { selectedEventId, events, loading: eventsLoading } = useEventScope();
  const [searchParams, setSearchParams] = useSearchParams();

  const [data, setData] = useState<Paginated<EntryRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [status, setStatus] = useState<string>(searchParams.get('status') ?? '');
  const [method, setMethod] = useState('');
  const [minRupees, setMinRupees] = useState('');
  const [maxRupees, setMaxRupees] = useState('');
  const [page, setPage] = useState(1);

  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [duplicates, setDuplicates] = useState<
    { guestName: string; amountPaise: number; count: number }[]
  >([]);

  const load = useCallback(async () => {
    if (!selectedEventId) return;
    setLoading(true);
    try {
      const result = await api.entries({
        eventId: selectedEventId,
        q: q.trim() || undefined,
        status: status || undefined,
        paymentMethod: method || undefined,
        minAmountPaise: minRupees ? Math.round(Number(minRupees) * 100) : undefined,
        maxAmountPaise: maxRupees ? Math.round(Number(maxRupees) * 100) : undefined,
        page,
        pageSize: 25,
        sortBy: 'createdAt',
        sortDir: 'desc',
      });
      setData(result);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load entries');
    } finally {
      setLoading(false);
    }
  }, [selectedEventId, q, status, method, minRupees, maxRupees, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedEventId) return;
    api
      .duplicates(selectedEventId)
      .then(setDuplicates)
      .catch(() => setDuplicates([]));
  }, [selectedEventId, data]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (q.trim()) next.set('q', q.trim());
    if (status) next.set('status', status);
    setSearchParams(next, { replace: true });
  }, [q, status, setSearchParams]);

  if (eventsLoading && !events.length) return <div className="spinner" />;
  if (!events.length) {
    return (
      <>
        <h1>Moi entries</h1>
        <div className="alert info">Create an event first.</div>
      </>
    );
  }

  return (
    <>
      <h1>Moi entries</h1>
      <p className="page-sub">
        Search, filter and verify contributions. Verified totals come only from matched bank
        credits or a recorded cash confirmation.
      </p>

      <div className="toolbar">
        <EventPicker />
        <div className="grow">
          <label htmlFor="q">Search</label>
          <input
            id="q"
            value={q}
            onChange={(domEvent) => {
              setPage(1);
              setQ(domEvent.target.value);
            }}
            placeholder="Name, place, phone, MOI code or UTR"
          />
        </div>
        <div>
          <label htmlFor="status">Status</label>
          <select
            id="status"
            value={status}
            onChange={(domEvent) => {
              setPage(1);
              setStatus(domEvent.target.value);
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="method">Method</label>
          <select
            id="method"
            value={method}
            onChange={(domEvent) => {
              setPage(1);
              setMethod(domEvent.target.value);
            }}
          >
            <option value="">All</option>
            <option value="UPI">UPI</option>
            <option value="CASH">Cash</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div style={{ width: 110 }}>
          <label htmlFor="min">Min &#8377;</label>
          <input
            id="min"
            value={minRupees}
            inputMode="decimal"
            onChange={(domEvent) => {
              setPage(1);
              setMinRupees(domEvent.target.value.replace(/[^\d.]/g, ''));
            }}
          />
        </div>
        <div style={{ width: 110 }}>
          <label htmlFor="max">Max &#8377;</label>
          <input
            id="max"
            value={maxRupees}
            inputMode="decimal"
            onChange={(domEvent) => {
              setPage(1);
              setMaxRupees(domEvent.target.value.replace(/[^\d.]/g, ''));
            }}
          />
        </div>
        <button className="btn" type="button" onClick={() => setShowManual(true)}>
          + Record entry
        </button>
      </div>

      {error ? <div className="alert err">{error}</div> : null}

      {duplicates.length ? (
        <div className="alert warn">
          {duplicates.length} possible duplicate group(s) in this event:{' '}
          {duplicates
            .slice(0, 4)
            .map((group) => group.guestName + ' (' + group.count + ')')
            .join(', ')}
          . Search the name to compare them.
        </div>
      ) : null}

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Guest</th>
                <th>Place</th>
                <th className="num">Amount</th>
                <th>Method</th>
                <th>Status</th>
                <th>Reference</th>
                <th>Recorded</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono">{entry.entryCode}</td>
                  <td>
                    {entry.guestName}
                    {entry.guestPhone ? (
                      <div className="muted">{entry.guestPhone}</div>
                    ) : null}
                  </td>
                  <td>{entry.guestAddress ?? '-'}</td>
                  <td className="num">{formatInr(entry.amountPaise)}</td>
                  <td>{entry.paymentMethod}</td>
                  <td>
                    <span className={'badge ' + entry.paymentStatus}>
                      {STATUS_LABEL[entry.paymentStatus]}
                    </span>
                  </td>
                  <td className="mono">{entry.paymentClaims[0]?.utr ?? '-'}</td>
                  <td>{formatDateTime(entry.createdAt)}</td>
                  <td>
                    <button
                      className="btn secondary small"
                      type="button"
                      onClick={() => setOpenEntryId(entry.id)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && data && !data.rows.length ? (
                <tr>
                  <td colSpan={9} className="muted">
                    No entries match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {data ? (
          <div className="pager">
            <span>
              {data.total} entries &middot; filtered total {formatInr(data.filteredSumPaise ?? 0)}
            </span>
            <button
              className="btn secondary small"
              type="button"
              disabled={data.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <span>
              Page {data.page} / {data.totalPages}
            </span>
            <button
              className="btn secondary small"
              type="button"
              disabled={data.page >= data.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>

      {openEntryId ? (
        <EntryDetailModal
          entryId={openEntryId}
          onClose={() => setOpenEntryId(null)}
          onChanged={() => void load()}
        />
      ) : null}

      {showManual ? (
        <ManualEntryModal
          eventId={selectedEventId}
          onClose={() => setShowManual(false)}
          onCreated={() => {
            setShowManual(false);
            void load();
          }}
        />
      ) : null}
    </>
  );
}
