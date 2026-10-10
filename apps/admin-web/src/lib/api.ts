const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) ?? 'http://localhost:4000/api';
const TOKEN_KEY = 'moi:admin-token';

export type PaymentStatus =
  | 'AWAITING_VERIFICATION'
  | 'VERIFIED'
  | 'REVIEW_REQUIRED'
  | 'NOT_FOUND'
  | 'REJECTED';

export type PaymentMethod = 'UPI' | 'CASH' | 'BANK_TRANSFER' | 'OTHER';

export interface AdminProfile {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'STAFF';
}

export interface EventSummary {
  id: string;
  slug: string;
  name: string;
  hostName: string | null;
  eventDate: string;
  venue: string | null;
  upiId: string | null;
  upiPayeeName: string | null;
  suggestedAmounts: number[];
  minAmountPaise: number;
  maxAmountPaise: number;
  collectPhone: boolean;
  requirePhone: boolean;
  isOpen: boolean;
  guestUrl: string;
  totals?: {
    entries: number;
    submittedPaise: number;
    verifiedPaise: number;
    verifiedCount: number;
    awaitingCount: number;
    reviewCount: number;
    notFoundCount: number;
  };
}

export interface Stats {
  totalEntries: number;
  submittedPaise: number;
  verifiedPaise: number;
  verifiedCount: number;
  awaitingCount: number;
  awaitingPaise: number;
  reviewCount: number;
  notFoundCount: number;
  rejectedCount: number;
  byMethod: Record<string, { count: number; sumPaise: number }>;
  topEntries: {
    entryCode: string;
    guestName: string;
    amountPaise: number;
    paymentStatus: PaymentStatus;
  }[];
}

export interface EntryRow {
  id: string;
  entryCode: string;
  guestName: string;
  guestAddress: string | null;
  guestPhone: string | null;
  relation: string | null;
  amountPaise: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  reviewReason: string | null;
  createdAt: string;
  verifiedAt: string | null;
  lastReconciledAt: string | null;
  note: string | null;
  event: { id: string; name: string; slug: string; eventDate: string };
  paymentClaims: { utr: string; status: string; createdAt: string }[];
  bankTransactions: { id: string; txnDate: string; reference: string | null; amountPaise: number }[];
}

export interface Paginated<T> {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  filteredSumPaise?: number;
  rows: T[];
}

export interface BankTransactionRow {
  id: string;
  txnDate: string;
  valueDate: string | null;
  description: string;
  reference: string | null;
  amountPaise: number;
  direction: 'CREDIT' | 'DEBIT';
  balancePaise: number | null;
  matchedEntryId: string | null;
  matchNote: string | null;
  matchedEntry?: { id: string; entryCode: string; guestName: string } | null;
  amountMatches?: boolean;
  referenceMatches?: boolean;
}

export interface ImportResult {
  import: {
    id: string;
    fileName: string;
    totalRows: number;
    importedRows: number;
    duplicateRows: number;
    skippedRows: number;
    createdAt: string;
  };
  detectedColumns: Record<string, number>;
  summary: {
    parsedRows: number;
    importedRows: number;
    duplicateRows: number;
    skippedRows: number;
    credits: number;
    debits: number;
  };
  skipped: { row: number; reason: string }[];
  reconciliation: ReconciliationSummary | null;
}

export interface ReconciliationSummary {
  eventId: string;
  scannedEntries: number;
  verified: number;
  reviewRequired: number;
  notFound: number;
  unchanged: number;
  results: {
    entryId: string;
    entryCode: string;
    status: PaymentStatus;
    previousStatus: PaymentStatus;
    changed: boolean;
    reason: string;
  }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export const auth = {
  get token(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Session-only fallback: the page keeps working until reload.
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
  },
};

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown; raw?: boolean };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  const token = auth.token;
  if (token) headers.Authorization = 'Bearer ' + token;

  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(API_BASE + path, { ...options, headers, body });
  } catch {
    throw new ApiError('Could not reach the API. Is it running?', 0);
  }

  if (response.status === 401) {
    auth.clear();
    if (!location.pathname.startsWith('/login')) location.assign('/login');
    throw new ApiError('Session expired. Please sign in again.', 401);
  }

  if (options.raw) {
    if (!response.ok) throw new ApiError('Export failed', response.status);
    return (await response.blob()) as unknown as T;
  }

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = Array.isArray(parsed?.message)
      ? parsed.message.join('. ')
      : parsed?.message?.message ?? parsed?.message ?? 'Request failed';
    throw new ApiError(String(message), response.status, parsed);
  }

  return parsed as T;
}

function query(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      if (value.length) search.set(key, value.join(','));
      return;
    }
    search.set(key, String(value));
  });
  const out = search.toString();
  return out ? '?' + out : '';
}

export const api = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; admin: AdminProfile }>('/admin/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  me: () => request<AdminProfile>('/admin/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/admin/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),

  events: () => request<EventSummary[]>('/admin/events'),

  createEvent: (payload: Record<string, unknown>) =>
    request<EventSummary>('/admin/events', { method: 'POST', body: payload }),

  updateEvent: (id: string, payload: Record<string, unknown>) =>
    request<EventSummary>('/admin/events/' + id, { method: 'PATCH', body: payload }),

  stats: (eventId?: string) => request<Stats>('/admin/stats' + query({ eventId })),

  entries: (params: Record<string, unknown>) =>
    request<Paginated<EntryRow>>('/admin/entries' + query(params)),

  entry: (id: string) => request<EntryRow & { event: EventSummary }>('/admin/entries/' + id),

  duplicates: (eventId: string) =>
    request<
      {
        guestName: string;
        amountPaise: number;
        count: number;
        entries: {
          id: string;
          entryCode: string;
          guestPhone: string | null;
          paymentStatus: PaymentStatus;
          paymentMethod: PaymentMethod;
          createdAt: string;
        }[];
      }[]
    >('/admin/entries/duplicates' + query({ eventId })),

  createEntry: (payload: Record<string, unknown>) =>
    request<EntryRow>('/admin/entries', { method: 'POST', body: payload }),

  addReference: (id: string, utr: string) =>
    request<unknown>('/admin/entries/' + id + '/payment-reference', {
      method: 'POST',
      body: { utr },
    }),

  review: (
    id: string,
    payload: {
      action: 'MATCH_TRANSACTION' | 'REJECT' | 'RESET' | 'CONFIRM_CASH';
      bankTransactionId?: string;
      reason: string;
    },
  ) => request<unknown>('/admin/entries/' + id + '/review', { method: 'POST', body: payload }),

  candidates: (entryId: string) =>
    request<BankTransactionRow[]>('/admin/reconciliation/entries/' + entryId + '/candidates'),

  runReconciliation: (eventId: string) =>
    request<ReconciliationSummary>('/admin/reconciliation/run', {
      method: 'POST',
      body: { eventId },
    }),

  runReconciliationForEntry: (entryId: string) =>
    request<unknown>('/admin/reconciliation/entries/' + entryId + '/run', { method: 'POST' }),

  importStatement: (file: File, eventId: string, autoReconcile: boolean, force = false) => {
    const form = new FormData();
    form.append('file', file);
    if (eventId) form.append('eventId', eventId);
    form.append('autoReconcile', String(autoReconcile));
    form.append('force', String(force));
    return request<ImportResult>('/admin/bank-statements/import', {
      method: 'POST',
      body: form,
    });
  },

  imports: (eventId?: string) =>
    request<
      {
        id: string;
        fileName: string;
        totalRows: number;
        importedRows: number;
        duplicateRows: number;
        skippedRows: number;
        createdAt: string;
        uploadedByAdmin: { name: string } | null;
        _count: { bankTransactions: number };
      }[]
    >('/admin/bank-statements/imports' + query({ eventId })),

  transactions: (params: Record<string, unknown>) =>
    request<Paginated<BankTransactionRow>>('/admin/bank-statements/transactions' + query(params)),

  exportReport: (format: 'xlsx' | 'pdf', params: Record<string, unknown>) =>
    request<Blob>('/admin/reports/export' + query({ ...params, format }), { raw: true }),
};

export function formatInr(paise: number): string {
  return (
    '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(paise / 100)
  );
}

export function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  AWAITING_VERIFICATION: 'Awaiting verification',
  VERIFIED: 'Verified',
  REVIEW_REQUIRED: 'Needs review',
  NOT_FOUND: 'Not in statement',
  REJECTED: 'Rejected',
};

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
