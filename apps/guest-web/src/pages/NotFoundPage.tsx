import { Banner } from '../components/ui';

export function NotFoundPage() {
  return (
    <main className="shell">
      <Banner tone="warn">
        This page needs an event link. Scan the QR code shown at the event, or ask the organizer for
        the link.
      </Banner>
      <p className="muted center">Event links look like /e/your-event-name</p>
    </main>
  );
}
