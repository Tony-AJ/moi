import { useState } from 'react';
import { api } from '../lib/api';

export function ManualEntryModal({
  eventId,
  onClose,
  onCreated,
}: {
  eventId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [guestName, setGuestName] = useState('');
  const [guestAddress, setGuestAddress] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [relation, setRelation] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'BANK_TRANSFER' | 'OTHER'>(
    'CASH',
  );
  const [confirmReceived, setConfirmReceived] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amountPaise = Math.round(Number(amountRupees.replace(/[^\d.]/g, '') || '0') * 100);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    if (guestName.trim().length < 2) return setError('Enter the guest name');
    if (!amountPaise) return setError('Enter the amount');

    setBusy(true);
    try {
      await api.createEntry({
        eventId,
        guestName: guestName.trim(),
        guestAddress: guestAddress.trim() || undefined,
        guestPhone: guestPhone.trim() || undefined,
        relation: relation.trim() || undefined,
        amountPaise,
        paymentMethod,
        confirmReceived: paymentMethod === 'CASH' ? confirmReceived : false,
        note: note.trim() || undefined,
      });
      onCreated();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not save the entry');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <form
        className="modal"
        onClick={(domEvent) => domEvent.stopPropagation()}
        onSubmit={submit}
        style={{ maxWidth: 520 }}
      >
        <div className="modal-head">
          <h2>Record an entry</h2>
          <button className="btn secondary small" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        {error ? <div className="alert err">{error}</div> : null}

        <div className="field">
          <label htmlFor="m-name">Guest name</label>
          <input
            id="m-name"
            value={guestName}
            onChange={(domEvent) => setGuestName(domEvent.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="m-place">Place / address</label>
          <input
            id="m-place"
            value={guestAddress}
            onChange={(domEvent) => setGuestAddress(domEvent.target.value)}
          />
        </div>

        <div className="toolbar">
          <div className="grow">
            <label htmlFor="m-phone">Phone</label>
            <input
              id="m-phone"
              value={guestPhone}
              onChange={(domEvent) => setGuestPhone(domEvent.target.value)}
              inputMode="tel"
            />
          </div>
          <div className="grow">
            <label htmlFor="m-relation">Relation</label>
            <input
              id="m-relation"
              value={relation}
              onChange={(domEvent) => setRelation(domEvent.target.value)}
            />
          </div>
        </div>

        <div className="toolbar">
          <div className="grow">
            <label htmlFor="m-amount">Amount &#8377;</label>
            <input
              id="m-amount"
              value={amountRupees}
              inputMode="decimal"
              onChange={(domEvent) => setAmountRupees(domEvent.target.value.replace(/[^\d.]/g, ''))}
              required
            />
          </div>
          <div className="grow">
            <label htmlFor="m-method">Method</label>
            <select
              id="m-method"
              value={paymentMethod}
              onChange={(domEvent) =>
                setPaymentMethod(domEvent.target.value as typeof paymentMethod)
              }
            >
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
        </div>

        {paymentMethod === 'CASH' ? (
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={confirmReceived}
                onChange={(domEvent) => setConfirmReceived(domEvent.target.checked)}
                style={{ width: 'auto', marginRight: 8 }}
              />
              I received this cash in hand (marks the entry verified under my name)
            </label>
          </div>
        ) : (
          <div className="alert info">
            Electronic entries stay unverified until a matching bank credit is reconciled.
          </div>
        )}

        <div className="field">
          <label htmlFor="m-note">Note</label>
          <input
            id="m-note"
            value={note}
            onChange={(domEvent) => setNote(domEvent.target.value)}
            placeholder="Optional"
          />
        </div>

        <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Saving...' : 'Save entry'}
        </button>
      </form>
    </div>
  );
}
