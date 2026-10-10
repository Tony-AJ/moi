import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, api, type EntryView } from '../lib/api';
import { Banner, Card, EventHeader, Spinner, StatusBadge, Steps, SummaryRow } from '../components/ui';

export function StatusPage() {
  const { token = '' } = useParams();

  const [entry, setEntry] = useState<EntryView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [utr, setUtr] = useState('');
  const [refError, setRefError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paymentOpened, setPaymentOpened] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  const load = useCallback(async () => {
    try {
      setEntry(await api.getStatus(token));
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'Could not load your entry');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitReference(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setRefError(null);

    const cleaned = utr.trim();
    if (cleaned.replace(/[^A-Za-z0-9]/g, '').length < 6) {
      setRefError('Enter the UPI reference / UTR number from your payment app');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await api.submitReference(token, cleaned);
      setEntry(updated);
      setUtr('');
      setJustSubmitted(true);
    } catch (error) {
      setRefError(error instanceof ApiError ? error.message : 'Could not save the reference');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <main className="shell">
        <Banner tone="err">{loadError}</Banner>
      </main>
    );
  }

  if (!entry) {
    return (
      <main className="shell">
        <Spinner />
      </main>
    );
  }

  const hasClaim = Boolean(entry.claims?.length);
  const isUpi = entry.paymentMethod === 'UPI';
  const step = entry.paymentStatus === 'VERIFIED' ? 3 : hasClaim || !isUpi ? 3 : 2;

  return (
    <main className="shell">
      <EventHeader
        name={entry.event.name}
        hostName={entry.event.hostName}
        eventDate={entry.event.eventDate}
        venue={entry.event.venue}
      />

      <Steps current={step} />

      {entry.deduplicated ? (
        <Banner tone="info">
          This entry was already saved, so we kept the original instead of creating a duplicate.
        </Banner>
      ) : null}

      {entry.possibleDuplicate ? (
        <Banner tone="warn">
          A very similar entry was recorded minutes ago. If you submitted twice by mistake, tell the
          organizer and they will remove the extra one.
        </Banner>
      ) : null}

      <Card title="Your entry">
        <p className="amount-big">{entry.amountDisplay}</p>
        <p className="center">
          <span className="code-pill">{entry.entryCode}</span>
        </p>
        <div style={{ marginTop: 14 }}>
          <SummaryRow label="Name" value={entry.guestName} />
          {entry.guestAddress ? <SummaryRow label="Place" value={entry.guestAddress} /> : null}
          <SummaryRow label="Method" value={isUpi ? 'UPI' : 'Cash'} />
          <SummaryRow label="Status" value={<StatusBadge status={entry.paymentStatus} />} />
          {entry.verifiedAt ? (
            <SummaryRow
              label="Verified on"
              value={new Date(entry.verifiedAt).toLocaleString('en-IN')}
            />
          ) : null}
        </div>
      </Card>

      {entry.paymentStatus === 'VERIFIED' ? (
        <Banner tone="ok">{entry.statusMessage}</Banner>
      ) : (
        <Banner tone="warn">{entry.statusMessage}</Banner>
      )}

      {isUpi && entry.upi && entry.paymentStatus !== 'VERIFIED' ? (
        <Card title="Step 1 — Pay by UPI">
          <SummaryRow label="Pay to" value={entry.upi.payeeName} />
          <SummaryRow label="UPI ID" value={entry.upi.payeeVpa} />
          <SummaryRow label="Amount" value={'₹' + entry.upi.amountRupees} />
          <SummaryRow label="Note" value={entry.upi.transactionNote} />

          <div style={{ marginTop: 14 }}>
            <a
              className="btn"
              href={entry.upi.upiLink}
              onClick={() => setPaymentOpened(true)}
              rel="noreferrer"
            >
              Open UPI app &amp; pay {'₹' + entry.upi.amountRupees}
            </a>
            <a
              className="btn secondary"
              href={entry.upi.appLinks.gpay}
              onClick={() => setPaymentOpened(true)}
              rel="noreferrer"
            >
              Pay with Google Pay
            </a>
            <a
              className="btn secondary"
              href={entry.upi.appLinks.phonepe}
              onClick={() => setPaymentOpened(true)}
              rel="noreferrer"
            >
              Pay with PhonePe
            </a>
          </div>

          <p className="hint" style={{ marginTop: 12 }}>
            {entry.upi.disclaimer}
          </p>
          <p className="hint">
            On a laptop the buttons will not open anything — scan the QR code with your phone
            instead, or pay the UPI ID above manually.
          </p>
        </Card>
      ) : null}

      {isUpi && entry.paymentStatus !== 'VERIFIED' ? (
        <Card title="Step 2 — Submit your UPI reference">
          {paymentOpened && !hasClaim ? (
            <Banner tone="info">
              Finished paying? Copy the UPI reference / UTR number from your payment app and paste
              it below.
            </Banner>
          ) : null}

          {justSubmitted ? (
            <Banner tone="ok">
              Reference saved. The organizer will match it against the bank statement.
            </Banner>
          ) : null}

          <form onSubmit={submitReference} noValidate>
            <div className="field">
              <label htmlFor="utr">UPI reference / UTR</label>
              <input
                id="utr"
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
                placeholder="e.g. 412345678901"
                inputMode="numeric"
                maxLength={40}
              />
              {refError ? <p className="error">{refError}</p> : null}
              <p className="hint">
                It is the 12 digit UTR / reference number shown on the payment receipt in your UPI
                app. Submitting it is not itself proof of payment — it only helps the organizer find
                your credit in the bank statement.
              </p>
            </div>
            <button className="btn" type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : hasClaim ? 'Submit a corrected reference' : 'Submit reference'}
            </button>
          </form>

          {entry.claims?.length ? (
            <div style={{ marginTop: 16 }}>
              <p className="muted">References you submitted</p>
              {entry.claims.map((claim) => (
                <SummaryRow
                  key={claim.utr}
                  label={claim.utr}
                  value={new Date(claim.submittedAt).toLocaleString('en-IN')}
                />
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {!isUpi ? (
        <Card title="Cash contribution">
          <p className="muted">
            Hand the cash to the organizer and show them this entry code. They will confirm it in
            the register.
          </p>
        </Card>
      ) : null}

      <button className="btn ghost" type="button" onClick={() => void load()}>
        Refresh status
      </button>

      <p className="footer-note">
        Save this page link to check your status later. Entry code {entry.entryCode}.
      </p>
    </main>
  );
}
