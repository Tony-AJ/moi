import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  actingWorkspace,
  api,
  downloadBlob,
  formatDate,
  formatDateTime,
  formatInr,
  type PlatformMember,
  type PlatformWorkspace,
} from '../lib/api';

interface IssuedCredentials {
  name: string;
  email: string;
  password: string;
  eventName: string | null;
  reason: 'NEW' | 'RESET';
}

const loginUrl = () => window.location.origin + '/login';

function credentialMessage(credentials: IssuedCredentials): string {
  const opening =
    credentials.reason === 'NEW'
      ? 'Your MoiLedger organizer login' +
        (credentials.eventName ? ' for "' + credentials.eventName + '"' : '') +
        ' is ready.'
      : 'Your MoiLedger password has been reset.';
  return [
    'Hello ' + credentials.name + ',',
    '',
    opening,
    '',
    'Sign in: ' + loginUrl(),
    'Email: ' + credentials.email,
    'One-time password: ' + credentials.password,
    '',
    'You will be asked to choose your own password when you sign in.',
    'Please do not share this message.',
  ].join('\n');
}

/**
 * Shown exactly once. The API never returns the password again and never
 * stores it, so leaving this screen without copying it means a reset.
 */
function CredentialsCard({
  credentials,
  onDone,
}: {
  credentials: IssuedCredentials;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState<'password' | 'message' | null>(null);

  async function copy(text: string, what: 'password' | 'message') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  }

  const message = credentialMessage(credentials);

  return (
    <div className="panel credentials">
      <h2>{credentials.reason === 'NEW' ? 'Organizer login created' : 'Password reset'}</h2>
      <div className="alert warn">
        Copy these now. The one-time password is shown only once and is not stored anywhere. If
        it is lost, reset it again.
      </div>

      <dl className="kv">
        <dt>Organizer</dt>
        <dd>{credentials.name}</dd>
        <dt>Sign-in page</dt>
        <dd className="mono">{loginUrl()}</dd>
        <dt>Email</dt>
        <dd className="mono">{credentials.email}</dd>
        <dt>One-time password</dt>
        <dd>
          <span className="secret mono">{credentials.password}</span>{' '}
          <button
            className="btn secondary small"
            type="button"
            onClick={() => copy(credentials.password, 'password')}
          >
            {copied === 'password' ? 'Copied' : 'Copy'}
          </button>
        </dd>
      </dl>

      <label htmlFor="credential-message">Message to send the organizer</label>
      <textarea id="credential-message" readOnly rows={10} value={message} className="mono" />

      <div className="row-actions" style={{ marginTop: 10 }}>
        <button className="btn" type="button" onClick={() => copy(message, 'message')}>
          {copied === 'message' ? 'Message copied' : 'Copy message'}
        </button>
        <button className="btn secondary" type="button" onClick={onDone}>
          I have sent it
        </button>
      </div>
    </div>
  );
}

function ProvisionForm({
  onCreated,
  onCancel,
}: {
  onCreated: (credentials: IssuedCredentials) => Promise<void>;
  onCancel: () => void;
}) {
  const [organizerName, setOrganizerName] = useState('');
  const [organizerEmail, setOrganizerEmail] = useState('');
  const [organizerPhone, setOrganizerPhone] = useState('');
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [hostName, setHostName] = useState('');
  const [venue, setVenue] = useState('');
  const [upiId, setUpiId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.platform.provisionOrganizer({
        upiId: upiId.trim(),
        payeeName: payeeName.trim() || organizerName.trim(),
        organizerName: organizerName.trim(),
        organizerEmail: organizerEmail.trim(),
        organizerPhone: organizerPhone.trim() || undefined,
        eventName: eventName.trim(),
        eventDate: new Date(eventDate + 'T10:00:00').toISOString(),
        hostName: hostName.trim() || undefined,
        venue: venue.trim() || undefined,
      });
      await onCreated({
        name: result.organizer.name,
        email: result.organizer.email,
        password: result.temporaryPassword,
        eventName: result.event.name,
        reason: 'NEW',
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the login');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h2>New event and organizer login</h2>
      <p className="muted">
        Creates the event against this organizer in their own workspace, sets the UPI account
        guests will pay into, and issues the organizer's login. The organizer can edit the event
        details but cannot create events or change the UPI account.
      </p>
      {error ? <div className="alert err">{error}</div> : null}

      <h3>Event</h3>
      <div className="toolbar">
        <div className="grow">
          <label htmlFor="p-event">Event name</label>
          <input
            id="p-event"
            value={eventName}
            onChange={(domEvent) => setEventName(domEvent.target.value)}
            placeholder="Kumar & Priya Wedding Reception"
            required
          />
        </div>
        <div>
          <label htmlFor="p-date">Event date</label>
          <input
            id="p-date"
            type="date"
            value={eventDate}
            onChange={(domEvent) => setEventDate(domEvent.target.value)}
            required
          />
        </div>
      </div>
      <div className="toolbar">
        <div className="grow">
          <label htmlFor="p-host">Host family (optional)</label>
          <input
            id="p-host"
            value={hostName}
            onChange={(domEvent) => setHostName(domEvent.target.value)}
          />
        </div>
        <div className="grow">
          <label htmlFor="p-venue">Venue (optional)</label>
          <input id="p-venue" value={venue} onChange={(domEvent) => setVenue(domEvent.target.value)} />
        </div>
      </div>

      <h3>Organizer</h3>
      <div className="toolbar">
        <div className="grow">
          <label htmlFor="p-name">Name</label>
          <input
            id="p-name"
            value={organizerName}
            onChange={(domEvent) => setOrganizerName(domEvent.target.value)}
            required
          />
        </div>
        <div className="grow">
          <label htmlFor="p-email">Email (their login)</label>
          <input
            id="p-email"
            type="email"
            value={organizerEmail}
            onChange={(domEvent) => setOrganizerEmail(domEvent.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="p-phone">Phone (optional)</label>
          <input
            id="p-phone"
            value={organizerPhone}
            inputMode="tel"
            onChange={(domEvent) => setOrganizerPhone(domEvent.target.value)}
          />
        </div>
      </div>

      <h3>Organizer's UPI account</h3>
      <div className="toolbar">
        <div className="grow">
          <label htmlFor="p-upi">UPI ID (guests pay here)</label>
          <input
            id="p-upi"
            value={upiId}
            onChange={(domEvent) => setUpiId(domEvent.target.value)}
            placeholder="familyname@okicici"
            required
          />
        </div>
        <div className="grow">
          <label htmlFor="p-payee">Payee name shown in the UPI app</label>
          <input
            id="p-payee"
            value={payeeName}
            onChange={(domEvent) => setPayeeName(domEvent.target.value)}
            placeholder="Defaults to the organizer's name"
          />
        </div>
      </div>
      <p className="muted">
        Check this ID with the organizer before saving: every UPI contribution for the event goes
        straight into it.
      </p>

      <div className="row-actions">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Creating...' : 'Create event and login'}
        </button>
        <button className="btn secondary" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddEventForm({
  workspace,
  onAdded,
  onCancel,
}: {
  workspace: PlatformWorkspace;
  onAdded: () => Promise<void>;
  onCancel: () => void;
}) {
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [upiId, setUpiId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currentUpi = workspace.events.find((event) => event.upiId)?.upiId ?? null;

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.platform.addEvent(workspace.id, {
        eventName: eventName.trim(),
        eventDate: new Date(eventDate + 'T10:00:00').toISOString(),
        upiId: upiId.trim() || undefined,
        payeeName: upiId.trim() ? payeeName.trim() || workspace.name : undefined,
      });
      await onAdded();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Could not add the event');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      {error ? <div className="alert err">{error}</div> : null}
      <div className="toolbar">
        <div className="grow">
          <label htmlFor={'add-name-' + workspace.id}>New event for {workspace.name}</label>
          <input
            id={'add-name-' + workspace.id}
            value={eventName}
            onChange={(domEvent) => setEventName(domEvent.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor={'add-date-' + workspace.id}>Date</label>
          <input
            id={'add-date-' + workspace.id}
            type="date"
            value={eventDate}
            onChange={(domEvent) => setEventDate(domEvent.target.value)}
            required
          />
        </div>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Adding...' : 'Add event'}
        </button>
        <button className="btn secondary" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      <div className="toolbar">
        <div className="grow">
          <label htmlFor={'add-upi-' + workspace.id}>
            UPI ID {currentUpi ? '(leave blank to keep ' + currentUpi + ')' : ''}
          </label>
          <input
            id={'add-upi-' + workspace.id}
            value={upiId}
            onChange={(domEvent) => setUpiId(domEvent.target.value)}
            placeholder="familyname@okicici"
            required={!currentUpi}
          />
        </div>
        <div className="grow">
          <label htmlFor={'add-payee-' + workspace.id}>Payee name</label>
          <input
            id={'add-payee-' + workspace.id}
            value={payeeName}
            onChange={(domEvent) => setPayeeName(domEvent.target.value)}
          />
        </div>
      </div>
      <p className="muted">The organizer sees it straight away with their existing login.</p>
    </form>
  );
}

function memberState(member: PlatformMember): { label: string; tone: string } {
  if (!member.isActive) return { label: 'Login disabled', tone: 'REJECTED' };
  if (member.mustChangePassword) return { label: 'Awaiting first sign-in', tone: 'AWAITING_VERIFICATION' };
  return { label: 'Active', tone: 'VERIFIED' };
}

const ROLE_LABEL: Record<string, string> = {
  WORKSPACE_OWNER: 'Organizer',
  WORKSPACE_ADMIN: 'Co-organizer',
  EVENT_STAFF: 'Event staff',
};

export function PlatformPage() {
  const [workspaces, setWorkspaces] = useState<PlatformWorkspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showProvision, setShowProvision] = useState(false);
  const [credentials, setCredentials] = useState<IssuedCredentials | null>(null);
  const [addingEventFor, setAddingEventFor] = useState<string | null>(null);
  const [suspending, setSuspending] = useState<{ id: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    // Back in the console means no longer acting inside one organizer.
    actingWorkspace.clear();
    try {
      setWorkspaces(await api.platform.overview());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load organizers');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(member: PlatformMember) {
    if (
      !window.confirm(
        'Reset the password for ' +
          member.name +
          '? Their current password stops working immediately and they will need the new one-time password to sign in.',
      )
    ) {
      return;
    }
    await act(async () => {
      const result = await api.platform.resetPassword(member.id);
      setCredentials({
        name: result.user.name,
        email: result.user.email,
        password: result.temporaryPassword,
        eventName: null,
        reason: 'RESET',
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function openWorkspace(workspace: PlatformWorkspace, path = '/') {
    actingWorkspace.set({ id: workspace.id, name: workspace.name });
    navigate(path);
  }

  async function downloadReport(
    workspace: PlatformWorkspace,
    eventId: string,
    slug: string,
    format: 'xlsx' | 'pdf',
  ) {
    await act(async () => {
      actingWorkspace.set({ id: workspace.id, name: workspace.name });
      try {
        const blob = await api.exportReport(format, { eventId });
        downloadBlob(blob, 'moi-register-' + slug + '.' + format);
      } finally {
        actingWorkspace.clear();
      }
    });
  }

  async function toggleLogin(member: PlatformMember) {
    const verb = member.isActive ? 'Disable' : 'Enable';
    if (!window.confirm(verb + ' the login for ' + member.name + '?')) return;
    await act(() => api.platform.setUserActive(member.id, !member.isActive));
  }

  if (!workspaces) {
    return error ? <div className="alert err">{error}</div> : <div className="spinner" />;
  }

  const allEvents = workspaces.flatMap((workspace) => workspace.events);
  const awaitingSignIn = workspaces
    .flatMap((workspace) => workspace.members)
    .filter((member) => member.isActive && member.mustChangePassword).length;
  const paymentPending = allEvents.filter((event) => !event.paymentReady).length;
  const verifiedTotal = allEvents.reduce((acc, event) => acc + event.totals.verifiedPaise, 0);

  return (
    <>
      <h1>Organizers &amp; events</h1>
      <p className="page-sub">
        You create every event against an organizer, set its UPI account, and can open any
        organizer's register, reconciliation and reports. Each organizer sees only their own
        events.
      </p>

      {error ? <div className="alert err">{error}</div> : null}

      {credentials ? (
        <CredentialsCard credentials={credentials} onDone={() => setCredentials(null)} />
      ) : null}

      <div className="cards">
        <div className="stat">
          <div className="label">Organizers</div>
          <div className="value">{workspaces.length}</div>
        </div>
        <div className="stat">
          <div className="label">Events</div>
          <div className="value">{allEvents.length}</div>
        </div>
        <div className="stat warn">
          <div className="label">Awaiting first sign-in</div>
          <div className="value">{awaitingSignIn}</div>
        </div>
        <div className="stat review">
          <div className="label">UPI not set up</div>
          <div className="value">{paymentPending}</div>
        </div>
        <div className="stat ok">
          <div className="label">Verified Moi, all events</div>
          <div className="value">{formatInr(verifiedTotal)}</div>
        </div>
      </div>

      {showProvision ? (
        <ProvisionForm
          onCancel={() => setShowProvision(false)}
          onCreated={async (issued) => {
            setShowProvision(false);
            setCredentials(issued);
            await load();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      ) : (
        <div className="panel">
          <button className="btn" type="button" onClick={() => setShowProvision(true)}>
            + New event &amp; organizer login
          </button>
        </div>
      )}

      {workspaces.map((workspace) => (
        <div className="panel" key={workspace.id}>
          <div className="modal-head">
            <div>
              <h2 style={{ marginBottom: 2 }}>{workspace.name}</h2>
              <p className="muted" style={{ margin: 0 }}>
                <span
                  className={
                    'badge ' + (workspace.status === 'ACTIVE' ? 'VERIFIED' : 'REJECTED')
                  }
                >
                  {workspace.status === 'ACTIVE' ? 'Active' : workspace.status.toLowerCase()}
                </span>{' '}
                {workspace.contactPhone ? workspace.contactPhone + ' · ' : ''}
                created {formatDate(workspace.createdAt)}
              </p>
              {workspace.status === 'SUSPENDED' && workspace.suspendedReason ? (
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  Suspended: {workspace.suspendedReason}
                </p>
              ) : null}
            </div>
            <div className="row-actions">
              <button
                className="btn small"
                type="button"
                disabled={busy}
                onClick={() => openWorkspace(workspace)}
              >
                Open register
              </button>
              <button
                className="btn secondary small"
                type="button"
                disabled={busy}
                onClick={() => setAddingEventFor(workspace.id)}
              >
                + Add event
              </button>
              {workspace.status === 'SUSPENDED' ? (
                <button
                  className="btn secondary small"
                  type="button"
                  disabled={busy}
                  onClick={() => act(() => api.platform.setWorkspaceStatus(workspace.id, 'ACTIVE'))}
                >
                  Restore access
                </button>
              ) : (
                <button
                  className="btn danger small"
                  type="button"
                  disabled={busy}
                  onClick={() => setSuspending({ id: workspace.id, reason: '' })}
                >
                  Suspend
                </button>
              )}
            </div>
          </div>

          {suspending?.id === workspace.id ? (
            <form
              className="inline-form"
              onSubmit={(formEvent) => {
                formEvent.preventDefault();
                void act(async () => {
                  await api.platform.setWorkspaceStatus(workspace.id, 'SUSPENDED', suspending.reason);
                  setSuspending(null);
                });
              }}
            >
              <div className="alert warn">
                Suspending closes the guest form for every event in this workspace and blocks the
                organizer&apos;s login until you restore it. Nothing is deleted.
              </div>
              <div className="toolbar">
                <div className="grow">
                  <label htmlFor={'reason-' + workspace.id}>Reason (shown in the audit log)</label>
                  <input
                    id={'reason-' + workspace.id}
                    value={suspending.reason}
                    onChange={(domEvent) =>
                      setSuspending({ id: workspace.id, reason: domEvent.target.value })
                    }
                    required
                    minLength={3}
                  />
                </div>
                <button className="btn danger" type="submit" disabled={busy}>
                  Suspend workspace
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => setSuspending(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {addingEventFor === workspace.id ? (
            <AddEventForm
              workspace={workspace}
              onCancel={() => setAddingEventFor(null)}
              onAdded={async () => {
                setAddingEventFor(null);
                await load();
              }}
            />
          ) : null}

          <h3>Logins</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {workspace.members.map((member) => {
                  const state = memberState(member);
                  return (
                    <tr key={member.id}>
                      <td>{member.name}</td>
                      <td className="mono">{member.email}</td>
                      <td>{ROLE_LABEL[member.role] ?? member.role}</td>
                      <td>
                        <span className={'badge ' + state.tone}>{state.label}</span>
                      </td>
                      <td>{member.lastLoginAt ? formatDateTime(member.lastLoginAt) : 'Never'}</td>
                      <td>
                        {member.platformRole === 'SUPER_ADMIN' ? null : (
                          <div className="row-actions">
                            <button
                              className="btn secondary small"
                              type="button"
                              disabled={busy}
                              onClick={() => resetPassword(member)}
                            >
                              Reset password
                            </button>
                            <button
                              className={'btn small ' + (member.isActive ? 'danger' : 'secondary')}
                              type="button"
                              disabled={busy}
                              onClick={() => toggleLogin(member)}
                            >
                              {member.isActive ? 'Disable login' : 'Enable login'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!workspace.members.length ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No login in this workspace.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <h3>Events</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Date</th>
                  <th>Guest form</th>
                  <th>UPI</th>
                  <th className="num">Entries</th>
                  <th className="num">Verified</th>
                  <th className="num">Submitted</th>
                  <th>Last activity</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {workspace.events.map((event) => (
                  <tr key={event.id}>
                    <td>{event.name}</td>
                    <td>{formatDate(event.eventDate)}</td>
                    <td>
                      <span className={'badge ' + (event.isOpen ? 'VERIFIED' : 'neutral')}>
                        {event.isOpen ? 'Open' : 'Closed'}
                      </span>
                    </td>
                    <td>
                      {event.upiId ? (
                        <span className="mono" title={event.payeeName ?? ''}>
                          {event.upiId}
                        </span>
                      ) : (
                        <span className="badge AWAITING_VERIFICATION">Not set up</span>
                      )}
                    </td>
                    <td className="num">{event.entryCount}</td>
                    <td className="num">{formatInr(event.totals.verifiedPaise)}</td>
                    <td className="num">{formatInr(event.totals.submittedPaise)}</td>
                    <td>{event.lastActivityAt ? formatDateTime(event.lastActivityAt) : '-'}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn secondary small"
                          type="button"
                          disabled={busy}
                          onClick={() => downloadReport(workspace, event.id, event.slug, 'xlsx')}
                        >
                          Excel
                        </button>
                        <button
                          className="btn secondary small"
                          type="button"
                          disabled={busy}
                          onClick={() => downloadReport(workspace, event.id, event.slug, 'pdf')}
                        >
                          PDF
                        </button>
                        <button
                          className="btn secondary small"
                          type="button"
                          onClick={() => navigator.clipboard?.writeText(event.guestUrl)}
                          title={event.guestUrl}
                        >
                          Copy link
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {!workspaces.length ? (
        <div className="alert info">No organizers yet. Create the first event above.</div>
      ) : null}
    </>
  );
}
