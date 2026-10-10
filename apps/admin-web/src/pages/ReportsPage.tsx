import { useEffect, useState } from 'react';
import { api, downloadBlob, formatInr, type Stats } from '../lib/api';
import { EventPicker, useEventScope } from '../lib/scope';

export function ReportsPage() {
  const { selectedEventId, selectedEvent, events, loading } = useEventScope();

  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!selectedEventId) return;
    api
      .stats(selectedEventId)
      .then(setStats)
      .catch(() => setStats(null));
  }, [selectedEventId]);

  async function exportReport(format: 'xlsx' | 'pdf') {
    setBusy(format);
    setError(null);
    try {
      const blob = await api.exportReport(format, {
        eventId: selectedEventId || undefined,
        status: status || undefined,
        dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
        dateTo: dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : undefined,
      });
      const name =
        'moi-register-' +
        (selectedEvent?.slug ?? 'all-events') +
        '-' +
        new Date().toISOString().slice(0, 10) +
        '.' +
        format;
      downloadBlob(blob, name);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  }

  if (loading && !events.length) return <div className="spinner" />;
  if (!events.length) {
    return (
      <>
        <h1>Reports</h1>
        <div className="alert info">Create an event first.</div>
      </>
    );
  }

  return (
    <>
      <h1>Reports</h1>
      <p className="page-sub">
        Exports carry the same filters you choose here, and the totals are computed from the same
        filtered rows.
      </p>

      <div className="toolbar">
        <EventPicker allowAll />
        <div>
          <label htmlFor="r-status">Status</label>
          <select
            id="r-status"
            value={status}
            onChange={(domEvent) => setStatus(domEvent.target.value)}
          >
            <option value="">All statuses</option>
            <option value="VERIFIED">Verified only</option>
            <option value="AWAITING_VERIFICATION">Awaiting verification</option>
            <option value="REVIEW_REQUIRED">Needs review</option>
            <option value="NOT_FOUND">Not in statement</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
        <div>
          <label htmlFor="r-from">From</label>
          <input
            id="r-from"
            type="date"
            value={dateFrom}
            onChange={(domEvent) => setDateFrom(domEvent.target.value)}
          />
        </div>
        <div>
          <label htmlFor="r-to">To</label>
          <input
            id="r-to"
            type="date"
            value={dateTo}
            onChange={(domEvent) => setDateTo(domEvent.target.value)}
          />
        </div>
      </div>

      {error ? <div className="alert err">{error}</div> : null}

      {stats ? (
        <div className="cards">
          <div className="stat">
            <div className="label">Entries</div>
            <div className="value">{stats.totalEntries}</div>
          </div>
          <div className="stat ok">
            <div className="label">Verified total</div>
            <div className="value">{formatInr(stats.verifiedPaise)}</div>
          </div>
          <div className="stat warn">
            <div className="label">Unverified total</div>
            <div className="value">{formatInr(stats.submittedPaise - stats.verifiedPaise)}</div>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <h2>Download</h2>
        <div className="row-actions">
          <button
            className="btn"
            type="button"
            disabled={busy !== null}
            onClick={() => exportReport('xlsx')}
          >
            {busy === 'xlsx' ? 'Building...' : 'Excel (.xlsx)'}
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={busy !== null}
            onClick={() => exportReport('pdf')}
          >
            {busy === 'pdf' ? 'Building...' : 'PDF register'}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          The Excel file has a Summary sheet and the full register; the PDF is the printable Moi
          register. Both state the verified total separately from pending claims, and both contain
          guest personal data — share only with people who should see it.
        </p>
      </div>
    </>
  );
}
