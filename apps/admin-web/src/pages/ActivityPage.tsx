import { useCallback, useEffect, useState } from 'react';
import { api, formatDateTime, formatInr, type ActivityRow } from '../lib/api';
import { EventPicker, useEventScope } from '../lib/scope';

const STATUS_WORDS: Record<string, string> = {
  AWAITING_VERIFICATION: 'awaiting verification',
  VERIFIED: 'verified',
  REVIEW_REQUIRED: 'needs review',
  NOT_FOUND: 'not in statement',
  REJECTED: 'rejected',
};

function meta(row: ActivityRow, key: string): unknown {
  return row.metadata ? row.metadata[key] : undefined;
}

function money(row: ActivityRow): string {
  const paise = meta(row, 'amountPaise');
  return typeof paise === 'number' ? ' · ' + formatInr(paise) : '';
}

function code(row: ActivityRow): string {
  const value = meta(row, 'entryCode');
  return typeof value === 'string' ? ' ' + value : '';
}

/** Plain-language line for each audited action. */
function describe(row: ActivityRow): string {
  switch (row.action) {
    case 'PLATFORM_ORGANIZER_PROVISIONED':
      return 'Workspace and organizer login created';
    case 'EVENT_CREATED':
      return 'Event created' + (meta(row, 'name') ? ': ' + String(meta(row, 'name')) : '');
    case 'EVENT_UPDATED': {
      const fields = row.metadata ? Object.keys(row.metadata).filter((k) => k !== 'workspaceId') : [];
      return 'Event details updated' + (fields.length ? ' (' + fields.join(', ') + ')' : '');
    }
    case 'EVENT_BENEFICIARY_SELECTED':
      return 'UPI payee set to ' + String(meta(row, 'upiId') ?? 'a payment account');
    case 'BENEFICIARY_CREATED':
      return 'Payment account added';
    case 'BENEFICIARY_CONFIRMED':
      return 'Payment account confirmed';
    case 'ENTRY_CREATED':
      return 'Guest registered' + code(row) + money(row);
    case 'ENTRY_CREATED_BY_ADMIN':
      return 'Entry recorded' + code(row) + money(row);
    case 'ENTRY_CREATED_CASH_CONFIRMED':
      return 'Cash entry recorded and confirmed' + code(row) + money(row);
    case 'PAYMENT_REFERENCE_CLAIMED':
      return 'UPI reference submitted';
    case 'ENTRY_VERIFIED_AUTO':
      return 'Entry verified against the bank statement';
    case 'ENTRY_VERIFIED_MANUAL':
      return 'Entry verified by linking a bank credit';
    case 'ENTRY_STATUS_CHANGED': {
      const from = STATUS_WORDS[String(meta(row, 'from'))] ?? meta(row, 'from');
      const to = STATUS_WORDS[String(meta(row, 'to'))] ?? meta(row, 'to');
      return 'Entry status changed from ' + from + ' to ' + to;
    }
    case 'ENTRY_CASH_CONFIRMED':
      return 'Cash receipt confirmed';
    case 'ENTRY_REJECTED':
      return 'Entry marked as not received';
    case 'ENTRY_RESET':
      return 'Entry reset to pending';
    case 'BANK_STATEMENT_IMPORTED':
      return (
        'Bank statement imported' +
        (typeof meta(row, 'importedRows') === 'number'
          ? ' (' + String(meta(row, 'importedRows')) + ' new rows)'
          : '')
      );
    case 'RECONCILIATION_RUN':
      return (
        'Matching run: ' +
        String(meta(row, 'verified') ?? 0) +
        ' verified, ' +
        String(meta(row, 'reviewRequired') ?? 0) +
        ' need review'
      );
    case 'REPORT_EXPORTED':
      return 'Report exported' + (meta(row, 'format') ? ' (' + String(meta(row, 'format')) + ')' : '');
    case 'PLATFORM_PASSWORD_RESET':
      return 'Password reset by the platform administrator';
    case 'PLATFORM_USER_DEACTIVATED':
      return 'Login disabled by the platform administrator';
    case 'PLATFORM_USER_ACTIVATED':
      return 'Login re-enabled by the platform administrator';
    case 'PLATFORM_WORKSPACE_SUSPENDED':
      return 'Access suspended' + (meta(row, 'reason') ? ': ' + String(meta(row, 'reason')) : '');
    case 'PLATFORM_WORKSPACE_RESTORED':
      return 'Access restored';
    default:
      return row.action.toLowerCase().replace(/_/g, ' ');
  }
}

function actorLabel(row: ActivityRow): string {
  switch (row.actor.kind) {
    case 'GUEST':
      return 'Guest';
    case 'SYSTEM':
      return 'System';
    case 'PLATFORM':
      return (row.actor.name ?? 'Platform') + ' (platform)';
    default:
      return row.actor.name ?? 'Team';
  }
}

export function ActivityPage() {
  const { selectedEventId, events, loading } = useEventScope();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (before?: string) => {
      setBusy(true);
      try {
        const page = await api.activity({
          eventId: selectedEventId || undefined,
          before,
          limit: 50,
        });
        setRows((current) => (before ? [...current, ...page.rows] : page.rows));
        setNextBefore(page.hasMore ? page.nextBefore : null);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load activity');
      } finally {
        setBusy(false);
      }
    },
    [selectedEventId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !events.length) return <div className="spinner" />;

  return (
    <>
      <h1>Activity</h1>
      <p className="page-sub">
        Everything that happened on your event, newest first: guest registrations, references,
        verifications, statement imports, exports and changes to the event.
      </p>

      <div className="toolbar">
        <EventPicker allowAll />
        <button className="btn secondary" type="button" disabled={busy} onClick={() => load()}>
          Refresh
        </button>
      </div>

      {error ? <div className="alert err">{error}</div> : null}

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>What happened</th>
                <th>By</th>
                {selectedEventId ? null : <th>Event</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(row.createdAt)}</td>
                  <td>{describe(row)}</td>
                  <td>{actorLabel(row)}</td>
                  {selectedEventId ? null : <td>{row.eventName ?? 'Workspace'}</td>}
                </tr>
              ))}
              {!busy && !rows.length ? (
                <tr>
                  <td colSpan={4} className="muted">
                    Nothing recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {nextBefore ? (
          <div className="pager">
            <button
              className="btn secondary small"
              type="button"
              disabled={busy}
              onClick={() => load(nextBefore)}
            >
              {busy ? 'Loading...' : 'Load older activity'}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
