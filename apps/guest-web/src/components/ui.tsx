import type { ReactNode } from 'react';
import type { PaymentStatus } from '../lib/api';

export function Banner({
  tone,
  children,
}: {
  tone: 'info' | 'ok' | 'warn' | 'err';
  children: ReactNode;
}) {
  return <div className={'banner ' + tone}>{children}</div>;
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

export function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="summary-row">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </div>
  );
}

const STATUS_LABEL: Record<PaymentStatus, string> = {
  AWAITING_VERIFICATION: 'Awaiting verification',
  VERIFIED: 'Verified',
  REVIEW_REQUIRED: 'Under review',
  NOT_FOUND: 'Not matched yet',
  REJECTED: 'Not received',
};

export function StatusBadge({ status }: { status: PaymentStatus }) {
  return <span className={'status-badge status-' + status}>{STATUS_LABEL[status]}</span>;
}

export function Steps({ current, total = 3 }: { current: number; total?: number }) {
  return (
    <div className="steps" aria-label={'Step ' + current + ' of ' + total}>
      {Array.from({ length: total }).map((_, index) => (
        <div key={index} className={'step' + (index < current ? ' done' : '')} />
      ))}
    </div>
  );
}

export function EventHeader({
  name,
  hostName,
  eventDate,
  venue,
}: {
  name: string;
  hostName?: string | null;
  eventDate: string;
  venue?: string | null;
}) {
  const date = new Date(eventDate).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <header className="event-head">
      <h1>{name}</h1>
      {hostName ? <p className="meta">Hosted by {hostName}</p> : null}
      <p className="meta">{date}</p>
      {venue ? <p className="meta">{venue}</p> : null}
    </header>
  );
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}
