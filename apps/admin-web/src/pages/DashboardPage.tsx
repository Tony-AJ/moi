import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatInr, type Stats } from '../lib/api';
import { EventPicker, useEventScope } from '../lib/scope';

export function DashboardPage() {
  const { selectedEventId, selectedEvent, events, loading: eventsLoading } = useEventScope();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .stats(selectedEventId || undefined)
      .then((data) => {
        if (active) setStats(data);
      })
      .catch((statsError: Error) => {
        if (active) setError(statsError.message);
      });
    return () => {
      active = false;
    };
  }, [selectedEventId]);

  if (eventsLoading && !events.length) return <div className="spinner" />;

  if (!events.length) {
    return (
      <>
        <h1>Dashboard</h1>
        <div className="alert info">
          No events yet. <Link to="/events">Create your first event</Link> to get a guest link and
          QR code.
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Dashboard</h1>
      <p className="page-sub">
        {selectedEvent ? selectedEvent.name : 'All events'} &middot; verified totals are the only
        bank-confirmed figures.
      </p>

      <div className="toolbar">
        <EventPicker allowAll />
      </div>

      {error ? <div className="alert err">{error}</div> : null}

      {stats ? (
        <>
          <div className="cards">
            <div className="stat">
              <div className="label">Total entries</div>
              <div className="value">{stats.totalEntries}</div>
              <div className="foot">{formatInr(stats.submittedPaise)} submitted</div>
            </div>
            <div className="stat ok">
              <div className="label">Verified Moi</div>
              <div className="value">{formatInr(stats.verifiedPaise)}</div>
              <div className="foot">{stats.verifiedCount} entries matched to bank credits</div>
            </div>
            <div className="stat warn">
              <div className="label">Awaiting verification</div>
              <div className="value">{stats.awaitingCount}</div>
              <div className="foot">{formatInr(stats.awaitingPaise)} unconfirmed</div>
            </div>
            <div className="stat review">
              <div className="label">Needs review</div>
              <div className="value">{stats.reviewCount}</div>
              <div className="foot">{stats.notFoundCount} not found in statement</div>
            </div>
          </div>

          <div className="panel">
            <h2>Next actions</h2>
            <ul className="muted" style={{ paddingLeft: 18, margin: 0 }}>
              <li>
                <Link to="/reconcile">Import the latest bank statement</Link> to verify pending
                entries.
              </li>
              <li>
                <Link to="/entries?status=REVIEW_REQUIRED">Resolve the review queue</Link> (
                {stats.reviewCount} waiting).
              </li>
              <li>
                <Link to="/reports">Export the register</Link> once reconciliation looks right.
              </li>
            </ul>
          </div>

          <div className="panel">
            <h2>By payment method</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Method</th>
                    <th className="num">Entries</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(stats.byMethod).map(([method, row]) => (
                    <tr key={method}>
                      <td>{method}</td>
                      <td className="num">{row.count}</td>
                      <td className="num">{formatInr(row.sumPaise)}</td>
                    </tr>
                  ))}
                  {!Object.keys(stats.byMethod).length ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No entries yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h2>Largest contributions</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Guest</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topEntries.map((entry) => (
                    <tr key={entry.entryCode}>
                      <td className="mono">{entry.entryCode}</td>
                      <td>{entry.guestName}</td>
                      <td className="num">{formatInr(entry.amountPaise)}</td>
                      <td>
                        <span className={'badge ' + entry.paymentStatus}>
                          {entry.paymentStatus.replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!stats.topEntries.length ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        No entries yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="spinner" />
      )}
    </>
  );
}
