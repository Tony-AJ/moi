import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, formatInr, newRequestId, type PublicEvent } from '../lib/api';
import { Banner, Card, EventHeader, Spinner, Steps } from '../components/ui';

interface FormErrors {
  guestName?: string;
  guestPhone?: string;
  amount?: string;
}

/** Remembers the token so a guest who reloads lands back on their own entry. */
function rememberToken(slug: string, token: string): void {
  try {
    localStorage.setItem('moi:last-entry:' + slug, token);
  } catch {
    // Private browsing — the printed entry code is still the fallback.
  }
}

function readToken(slug: string): string | null {
  try {
    return localStorage.getItem('moi:last-entry:' + slug);
  } catch {
    return null;
  }
}

export function EventPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();

  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [existingToken, setExistingToken] = useState<string | null>(null);

  const [guestName, setGuestName] = useState('');
  const [guestAddress, setGuestAddress] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [relation, setRelation] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'CASH'>('UPI');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // One idempotency key per filled-in form; a retry reuses it.
  const requestId = useRef(newRequestId());

  useEffect(() => {
    let active = true;
    api
      .getEvent(slug)
      .then((data) => {
        if (active) setEvent(data);
      })
      .catch((error: ApiError) => {
        if (active) setLoadError(error.message);
      });
    setExistingToken(readToken(slug));
    return () => {
      active = false;
    };
  }, [slug]);

  const amountPaise = useMemo(() => {
    const cleaned = amountRupees.replace(/[^\d.]/g, '');
    if (!cleaned) return 0;
    return Math.round(Number(cleaned) * 100);
  }, [amountRupees]);

  function validate(): boolean {
    if (!event) return false;
    const next: FormErrors = {};

    if (guestName.trim().length < 2) next.guestName = 'Please enter your full name';
    if (event.requirePhone && guestPhone.replace(/\D/g, '').length < 10) {
      next.guestPhone = 'A 10 digit phone number is required for this event';
    } else if (guestPhone && guestPhone.replace(/\D/g, '').length < 10) {
      next.guestPhone = 'Enter a valid 10 digit phone number';
    }

    if (!amountPaise) next.amount = 'Enter the Moi amount';
    else if (amountPaise < event.minAmountPaise) {
      next.amount = 'Minimum is ' + formatInr(event.minAmountPaise);
    } else if (amountPaise > event.maxAmountPaise) {
      next.amount = 'Maximum is ' + formatInr(event.maxAmountPaise);
    } else if (!Number.isInteger(amountPaise)) {
      next.amount = 'Enter a valid amount';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setSubmitError(null);
    if (submitting || !validate()) return;

    setSubmitting(true);
    try {
      const entry = await api.createEntry(slug, {
        guestName: guestName.trim(),
        guestAddress: guestAddress.trim() || undefined,
        guestPhone: guestPhone.trim() || undefined,
        relation: relation.trim() || undefined,
        amountPaise,
        paymentMethod,
        clientRequestId: requestId.current,
      });
      rememberToken(slug, entry.accessToken);
      navigate('/t/' + entry.accessToken, { replace: true });
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Could not save your entry');
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <main className="shell">
        <Banner tone="err">{loadError}</Banner>
        <p className="muted center">
          Check the QR code or the link with the event organizer.
        </p>
      </main>
    );
  }

  if (!event) {
    return (
      <main className="shell">
        <Spinner />
      </main>
    );
  }

  return (
    <main className="shell">
      <EventHeader
        name={event.name}
        hostName={event.hostName}
        eventDate={event.eventDate}
        venue={event.venue}
      />

      <Steps current={1} />

      {!event.isOpen ? (
        <Banner tone="warn">
          This event is no longer accepting entries. Please contact the organizer directly.
        </Banner>
      ) : null}

      {existingToken ? (
        <Banner tone="info">
          You already made an entry for this event.{' '}
          <a href={'/t/' + existingToken}>View its status</a>, or fill the form again to add
          another contribution.
        </Banner>
      ) : null}

      {submitError ? <Banner tone="err">{submitError}</Banner> : null}

      <form onSubmit={handleSubmit} noValidate>
        <Card title="Your details">
          <div className="field">
            <label htmlFor="guestName">Name</label>
            <input
              id="guestName"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              autoComplete="name"
              disabled={!event.isOpen}
              maxLength={120}
            />
            {errors.guestName ? <p className="error">{errors.guestName}</p> : null}
          </div>

          <div className="field">
            <label htmlFor="guestAddress">Place / Address</label>
            <input
              id="guestAddress"
              value={guestAddress}
              onChange={(e) => setGuestAddress(e.target.value)}
              placeholder="e.g. Coimbatore"
              disabled={!event.isOpen}
              maxLength={240}
            />
            <p className="hint">Printed in the Moi register next to your name.</p>
          </div>

          {event.collectPhone ? (
            <div className="field">
              <label htmlFor="guestPhone">
                Phone {event.requirePhone ? '' : '(optional)'}
              </label>
              <input
                id="guestPhone"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                disabled={!event.isOpen}
                maxLength={20}
              />
              {errors.guestPhone ? <p className="error">{errors.guestPhone}</p> : null}
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="relation">Relation (optional)</label>
            <input
              id="relation"
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
              placeholder="e.g. Friend, Uncle"
              disabled={!event.isOpen}
              maxLength={60}
            />
          </div>
        </Card>

        <Card title="Moi amount">
          <div className="field">
            <div className="amount-input">
              <span className="rupee">&#8377;</span>
              <input
                id="amount"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value.replace(/[^\d.]/g, ''))}
                inputMode="decimal"
                placeholder="0"
                disabled={!event.isOpen}
                aria-label="Moi amount in rupees"
              />
            </div>
            {errors.amount ? <p className="error">{errors.amount}</p> : null}
            {event.suggestedAmounts.length ? (
              <div className="chips">
                {event.suggestedAmounts.map((paise) => (
                  <button
                    type="button"
                    key={paise}
                    className="chip"
                    aria-pressed={amountPaise === paise}
                    onClick={() => setAmountRupees(String(paise / 100))}
                    disabled={!event.isOpen}
                  >
                    {formatInr(paise)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="method">How are you giving?</label>
            <select
              id="method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as 'UPI' | 'CASH')}
              disabled={!event.isOpen}
            >
              <option value="UPI">UPI payment now</option>
              <option value="CASH">Cash handed to the family</option>
            </select>
            <p className="hint">
              {paymentMethod === 'UPI'
                ? 'The next screen opens your UPI app with the amount already filled in.'
                : 'The organizer will confirm the cash at the venue.'}
            </p>
          </div>

          {paymentMethod === 'UPI' && !event.upiConfigured ? (
            <Banner tone="warn">
              UPI is not configured for this event yet. Choose cash, or ask the organizer.
            </Banner>
          ) : null}
        </Card>

        <button className="btn" type="submit" disabled={submitting || !event.isOpen}>
          {submitting ? 'Saving...' : 'Save and continue'}
        </button>
      </form>

      <p className="footer-note">
        We never ask for your UPI PIN, OTP or bank password. Your contribution is marked verified
        only after the organizer matches it with the bank record.
      </p>
    </main>
  );
}
