import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  api,
  formatDate,
  formatInr,
  type BeneficiaryAccount,
  type EventSummary,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { useEventScope } from '../lib/scope';

function GuestQr({ event }: { event: EventSummary }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  // The QR always encodes the deployed guest URL the API hands back, so a
  // printed code can never point at localhost by accident.
  const guestUrl = event.guestUrl;

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, guestUrl, { width: 220, margin: 1 }).catch(
      (qrError: Error) => setError(qrError.message),
    );
  }, [guestUrl]);

  async function download() {
    try {
      const dataUrl = await QRCode.toDataURL(guestUrl, { width: 1024, margin: 2 });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = 'moi-qr-' + event.slug + '.png';
      link.click();
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Could not build the QR');
    }
  }

  const isLocalhost = /localhost|127\.0\.0\.1/.test(guestUrl);

  return (
    <div className="qr-box">
      <canvas ref={canvasRef} />
      <div>
        <p className="muted" style={{ marginTop: 0 }}>
          Guest link
        </p>
        <p className="mono" style={{ wordBreak: 'break-all' }}>
          {guestUrl}
        </p>
        {isLocalhost ? (
          <div className="alert warn">
            This is a localhost link — fine for testing, but set GUEST_WEB_URL on the API before
            printing the QR for the event.
          </div>
        ) : null}
        {error ? <div className="alert err">{error}</div> : null}
        <div className="row-actions">
          <button className="btn secondary small" type="button" onClick={download}>
            Download PNG
          </button>
          <button
            className="btn secondary small"
            type="button"
            onClick={() => navigator.clipboard?.writeText(guestUrl)}
          >
            Copy link
          </button>
          <button className="btn secondary small" type="button" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Payment accounts for the workspace.
 *
 * A UPI id typed into a form is not evidence that the account belongs to the
 * customer, so a new account starts unconfirmed and cannot collect anything
 * until the owner confirms the details. Reconciliation against the real bank
 * statement is what later proves the money arrived.
 */
function BeneficiaryPanel({
  events,
  onChanged,
}: {
  events: EventSummary[];
  onChanged: () => Promise<void>;
}) {
  const [accounts, setAccounts] = useState<BeneficiaryAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [label, setLabel] = useState('');
  const [upiId, setUpiId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountLast4, setAccountLast4] = useState('');

  const [assignEventId, setAssignEventId] = useState('');
  const [assignAccountId, setAssignAccountId] = useState('');

  async function load() {
    try {
      setAccounts(await api.beneficiaries());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load payment accounts');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function addAccount(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createBeneficiary({
        label,
        upiId,
        payeeName,
        bankName: bankName || undefined,
        accountLast4: accountLast4 || undefined,
      });
      setLabel('');
      setUpiId('');
      setPayeeName('');
      setBankName('');
      setAccountLast4('');
      setShowForm(false);
      await load();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Could not add the account');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.confirmBeneficiary(id);
      await load();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'Could not confirm');
    } finally {
      setBusy(false);
    }
  }

  async function assign(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (!assignEventId || !assignAccountId) return;
    setBusy(true);
    setError(null);
    try {
      await api.selectEventBeneficiary(assignEventId, assignAccountId);
      await Promise.all([load(), onChanged()]);
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'Could not set the payee');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Payment accounts</h2>
      <p className="muted">
        Contributions go straight to the account configured here. Confirm the details before an
        event uses it.
      </p>

      {error ? <div className="alert err">{error}</div> : null}

      {accounts.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>Label</th>
              <th>UPI id</th>
              <th>Payee</th>
              <th>Status</th>
              <th>Events</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <td>{account.label}</td>
                <td>{account.upiId}</td>
                <td>{account.payeeName}</td>
                <td>{account.status === 'CONFIRMED' ? 'Confirmed' : 'Not confirmed'}</td>
                <td>{account._count.paymentConfigs}</td>
                <td>
                  {account.status === 'CONFIRMED' ? null : (
                    <button
                      className="btn small"
                      type="button"
                      disabled={busy}
                      onClick={() => confirm(account.id)}
                    >
                      Confirm details
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="alert info">No payment account configured yet.</div>
      )}

      {showForm ? (
        <form className="form" onSubmit={addAccount}>
          <div className="row">
            <div className="grow">
              <label htmlFor="ben-label">Label</label>
              <input
                id="ben-label"
                value={label}
                required
                placeholder="Primary collection account"
                onChange={(domEvent) => setLabel(domEvent.target.value)}
              />
            </div>
            <div className="grow">
              <label htmlFor="ben-upi">UPI id</label>
              <input
                id="ben-upi"
                value={upiId}
                required
                placeholder="name@okicici"
                onChange={(domEvent) => setUpiId(domEvent.target.value)}
              />
            </div>
          </div>
          <div className="row">
            <div className="grow">
              <label htmlFor="ben-payee">Payee name</label>
              <input
                id="ben-payee"
                value={payeeName}
                required
                onChange={(domEvent) => setPayeeName(domEvent.target.value)}
              />
            </div>
            <div className="grow">
              <label htmlFor="ben-bank">Bank (optional)</label>
              <input
                id="ben-bank"
                value={bankName}
                onChange={(domEvent) => setBankName(domEvent.target.value)}
              />
            </div>
            <div>
              <label htmlFor="ben-last4">Last 4 digits (optional)</label>
              <input
                id="ben-last4"
                value={accountLast4}
                maxLength={4}
                inputMode="numeric"
                onChange={(domEvent) => setAccountLast4(domEvent.target.value)}
              />
            </div>
          </div>
          <p className="muted">
            Only the last four digits are stored, and only to help identify which account an
            uploaded statement came from.
          </p>
          <div className="row">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Saving...' : 'Add account'}
            </button>
            <button className="btn secondary" type="button" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="btn secondary" type="button" onClick={() => setShowForm(true)}>
          + Add payment account
        </button>
      )}

      <h3 style={{ marginTop: 20 }}>Set the payee for an event</h3>
      <p className="muted">
        Changing this starts a new configuration version. Contributions already recorded keep the
        payee they were collected against.
      </p>
      <form className="toolbar" onSubmit={assign}>
        <div className="grow">
          <label htmlFor="assign-event">Event</label>
          <select
            id="assign-event"
            value={assignEventId}
            onChange={(domEvent) => setAssignEventId(domEvent.target.value)}
          >
            <option value="">Select an event</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grow">
          <label htmlFor="assign-account">Payment account</label>
          <select
            id="assign-account"
            value={assignAccountId}
            onChange={(domEvent) => setAssignAccountId(domEvent.target.value)}
          >
            <option value="">Select a confirmed account</option>
            {accounts
              .filter((account) => account.status === 'CONFIRMED')
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label} ({account.upiId})
                </option>
              ))}
          </select>
        </div>
        <button className="btn" type="submit" disabled={busy || !assignEventId || !assignAccountId}>
          Set payee
        </button>
      </form>
    </div>
  );
}

export function EventsPage() {
  const { events, reload, loading, error } = useEventScope();
  const { admin } = useAuth();
  const isOwner = admin?.role === 'OWNER';

  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [hostName, setHostName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [venue, setVenue] = useState('');
  const [upiId, setUpiId] = useState('');
  const [upiPayeeName, setUpiPayeeName] = useState('');
  const [collectPhone, setCollectPhone] = useState(true);

  async function createEvent(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setFormError(null);
    if (!name.trim() || !eventDate) {
      setFormError('Event name and date are required');
      return;
    }

    setBusy(true);
    try {
      await api.createEvent({
        name: name.trim(),
        hostName: hostName.trim() || undefined,
        eventDate: new Date(eventDate).toISOString(),
        venue: venue.trim() || undefined,
        upiId: upiId.trim() || undefined,
        upiPayeeName: upiPayeeName.trim() || undefined,
        collectPhone,
      });
      setShowForm(false);
      setName('');
      setHostName('');
      setEventDate('');
      setVenue('');
      setUpiId('');
      setUpiPayeeName('');
      await reload();
    } catch (createError) {
      setFormError(createError instanceof Error ? createError.message : 'Could not create event');
    } finally {
      setBusy(false);
    }
  }

  async function toggleOpen(event: EventSummary) {
    setBusy(true);
    try {
      await api.updateEvent(event.id, { isOpen: !event.isOpen });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  if (loading && !events.length) return <div className="spinner" />;

  return (
    <>
      <h1>Events &amp; QR codes</h1>
      <p className="page-sub">
        Each event has its own guest link and QR code. Close an event to stop new guest entries.
      </p>

      {error ? <div className="alert err">{error}</div> : null}

      <BeneficiaryPanel events={events} onChanged={reload} />

      {isOwner ? (
        <div className="panel">
          {!showForm ? (
            <button className="btn" type="button" onClick={() => setShowForm(true)}>
              + New event
            </button>
          ) : (
            <form onSubmit={createEvent}>
              <h2>New event</h2>
              {formError ? <div className="alert err">{formError}</div> : null}
              <div className="toolbar">
                <div className="grow">
                  <label htmlFor="e-name">Event name</label>
                  <input
                    id="e-name"
                    value={name}
                    onChange={(domEvent) => setName(domEvent.target.value)}
                    required
                  />
                </div>
                <div className="grow">
                  <label htmlFor="e-host">Host family</label>
                  <input
                    id="e-host"
                    value={hostName}
                    onChange={(domEvent) => setHostName(domEvent.target.value)}
                  />
                </div>
              </div>
              <div className="toolbar">
                <div>
                  <label htmlFor="e-date">Event date</label>
                  <input
                    id="e-date"
                    type="date"
                    value={eventDate}
                    onChange={(domEvent) => setEventDate(domEvent.target.value)}
                    required
                  />
                </div>
                <div className="grow">
                  <label htmlFor="e-venue">Venue</label>
                  <input
                    id="e-venue"
                    value={venue}
                    onChange={(domEvent) => setVenue(domEvent.target.value)}
                  />
                </div>
              </div>
              <div className="toolbar">
                <div className="grow">
                  <label htmlFor="e-upi">UPI ID (leave blank to use the server default)</label>
                  <input
                    id="e-upi"
                    value={upiId}
                    onChange={(domEvent) => setUpiId(domEvent.target.value)}
                    placeholder="yourname@okicici"
                  />
                </div>
                <div className="grow">
                  <label htmlFor="e-payee">UPI payee name</label>
                  <input
                    id="e-payee"
                    value={upiPayeeName}
                    onChange={(domEvent) => setUpiPayeeName(domEvent.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label>
                  <input
                    type="checkbox"
                    checked={collectPhone}
                    onChange={(domEvent) => setCollectPhone(domEvent.target.checked)}
                    style={{ width: 'auto', marginRight: 8 }}
                  />
                  Ask guests for a phone number (optional field)
                </label>
              </div>
              <div className="row-actions">
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? 'Creating...' : 'Create event'}
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      ) : null}

      {events.map((event) => (
        <div className="panel" key={event.id}>
          <div className="modal-head">
            <div>
              <h2 style={{ marginBottom: 2 }}>{event.name}</h2>
              <p className="muted" style={{ margin: 0 }}>
                {formatDate(event.eventDate)}
                {event.venue ? ' · ' + event.venue : ''} ·{' '}
                <span className={'badge ' + (event.isOpen ? 'VERIFIED' : 'neutral')}>
                  {event.isOpen ? 'Open' : 'Closed'}
                </span>
              </p>
            </div>
            {isOwner ? (
              <button
                className="btn secondary small"
                type="button"
                disabled={busy}
                onClick={() => toggleOpen(event)}
              >
                {event.isOpen ? 'Close entries' : 'Reopen entries'}
              </button>
            ) : null}
          </div>

          {event.totals ? (
            <div className="cards">
              <div className="stat">
                <div className="label">Entries</div>
                <div className="value">{event.totals.entries}</div>
              </div>
              <div className="stat ok">
                <div className="label">Verified</div>
                <div className="value">{formatInr(event.totals.verifiedPaise)}</div>
                <div className="foot">{event.totals.verifiedCount} entries</div>
              </div>
              <div className="stat warn">
                <div className="label">Pending</div>
                <div className="value">{event.totals.awaitingCount}</div>
              </div>
              <div className="stat review">
                <div className="label">Review</div>
                <div className="value">{event.totals.reviewCount}</div>
              </div>
            </div>
          ) : null}

          <GuestQr event={event} />

          <p className="muted" style={{ marginTop: 12 }}>
            UPI payee:{' '}
            {event.upiId
              ? event.upiId + (event.upiPayeeName ? ' (' + event.upiPayeeName + ')' : '')
              : 'not configured - this event cannot take online payments yet'}
          </p>
        </div>
      ))}

      {!events.length ? <div className="alert info">No events yet.</div> : null}
    </>
  );
}
