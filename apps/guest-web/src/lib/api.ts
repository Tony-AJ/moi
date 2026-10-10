const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) ?? 'http://localhost:4000/api';

export interface PublicEvent {
  slug: string;
  name: string;
  hostName: string | null;
  eventDate: string;
  venue: string | null;
  suggestedAmounts: number[];
  minAmountPaise: number;
  maxAmountPaise: number;
  collectPhone: boolean;
  requirePhone: boolean;
  isOpen: boolean;
  upiConfigured: boolean;
  payeeName: string;
}

export interface UpiHandoff {
  payeeVpa: string;
  payeeName: string;
  amountRupees: string;
  transactionNote: string;
  referenceId: string;
  upiLink: string;
  appLinks: Record<string, string>;
  disclaimer: string;
}

export type PaymentStatus =
  | 'AWAITING_VERIFICATION'
  | 'VERIFIED'
  | 'REVIEW_REQUIRED'
  | 'NOT_FOUND'
  | 'REJECTED';

export interface EntryView {
  entryCode: string;
  accessToken: string;
  guestName: string;
  guestAddress: string | null;
  amountPaise: number;
  amountDisplay: string;
  paymentMethod: 'UPI' | 'CASH' | 'BANK_TRANSFER' | 'OTHER';
  paymentStatus: PaymentStatus;
  statusMessage: string;
  createdAt: string;
  verifiedAt: string | null;
  event: {
    slug: string;
    name: string;
    hostName: string | null;
    eventDate: string;
    venue: string | null;
  };
  upi: UpiHandoff | null;
  possibleDuplicate?: boolean;
  deduplicated?: boolean;
  claims?: { utr: string; status: string; submittedAt: string }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API_BASE + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = Array.isArray(body?.message)
      ? body.message.join('. ')
      : body?.message ?? 'Something went wrong';
    throw new ApiError(String(message), response.status);
  }

  return body as T;
}

export const api = {
  getEvent: (slug: string) => request<PublicEvent>('/events/' + encodeURIComponent(slug)),

  createEntry: (
    slug: string,
    payload: {
      guestName: string;
      guestAddress?: string;
      guestPhone?: string;
      relation?: string;
      amountPaise: number;
      paymentMethod: 'UPI' | 'CASH';
      clientRequestId: string;
      note?: string;
    },
  ) =>
    request<EntryView>('/events/' + encodeURIComponent(slug) + '/entries', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getStatus: (token: string) => request<EntryView>('/entries/' + token + '/status'),

  submitReference: (token: string, utr: string) =>
    request<EntryView>('/entries/' + token + '/payment-reference', {
      method: 'POST',
      body: JSON.stringify({ utr }),
    }),
};

/** Stable key so a double tap on Submit cannot create two entries. */
export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function formatInr(paise: number): string {
  return (
    '₹' +
    new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(paise / 100)
  );
}
