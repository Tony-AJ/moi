const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) ?? 'http://localhost:4000/api';
const TOKEN_KEY = 'moi:admin-token';
const ACTING_KEY = 'moi:acting-workspace';

/**
 * The organizer workspace a super admin has opened from the console. Sent as
 * X-Workspace-Id so every organizer screen works for them unchanged.
 */
export const actingWorkspace = {
  get(): { id: string; name: string } | null {
    try {
      const raw = localStorage.getItem(ACTING_KEY);
      return raw ? (JSON.parse(raw) as { id: string; name: string }) : null;
    } catch {
      return null;
    }
  },
  set(workspace: { id: string; name: string }): void {
    try {
      localStorage.setItem(ACTING_KEY, JSON.stringify(workspace));
    } catch {
      // ignore
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(ACTING_KEY);
    } catch {
      // ignore
    }
  },
};

export type PaymentStatus =
  | 'AWAITING_VERIFICATION'
  | 'VERIFIED'
  | 'REVIEW_REQUIRED'
  | 'NOT_FOUND'
  | 'REJECTED';

export type PaymentMethod = 'UPI' | 'CASH' | 'BANK_TRANSFER' | 'OTHER';

export type WorkspaceRole = 'WORKSPACE_OWNER' | 'WORKSPACE_ADMIN' | 'EVENT_STAFF';

export interface Membership {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  workspaceStatus: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  role: WorkspaceRole;
}

export interface AdminProfile {
  id: string;
  email: string;
  name: string;
  /** Legacy flat role; authorization comes from memberships. */
  role: 'OWNER' | 'STAFF';
  platformRole: 'USER' | 'SUPER_ADMIN';
  /** True while the user still holds a password somebody else issued. */
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  memberships: Membership[];
}

export const isSuperAdmin = (profile: AdminProfile | null): boolean =>
  profile?.platformRole === 'SUPER_ADMIN';

/** Role in the workspace the admin app is operating in (the first one). */
export const workspaceRole = (profile: AdminProfile | null): WorkspaceRole | null =>
  profile?.memberships[0]?.role ?? null;

export const canManageWorkspace = (profile: AdminProfile | null): boolean => {
  if (isSuperAdmin(profile)) return true;
  const role = workspaceRole(profile);
  return role === 'WORKSPACE_OWNER' || role === 'WORKSPACE_ADMIN';
};

export interface PlatformMember {
  id: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  isActive: boolean;
  platformRole: 'USER' | 'SUPER_ADMIN';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export interface PlatformEvent {
  id: string;
  name: string;
  slug: string;
  eventDate: string;
  venue: string | null;
  isOpen: boolean;
  guestUrl: string;
  paymentReady: boolean;
  upiId: string | null;
  payeeName: string | null;
  totals: {
    submittedPaise: number;
    verifiedPaise: number;
    verifiedCount: number;
    reviewCount: number;
  };
  entryCount: number;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface PlatformWorkspace {
  id: string;
  name: string;
  slug: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  contactEmail: string | null;
  contactPhone: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  createdAt: string;
  members: PlatformMember[];
  events: PlatformEvent[];
}

export interface ProvisionResult {
  workspace: { id: string; name: string; slug: string };
  event: { id: string; name: string; slug: string; eventDate: string; guestUrl: string };
  organizer: { id: string; name: string; email: string };
  /** Shown once; organizers cannot change it themselves. */
  password: string;
}

export interface ActivityRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  eventId: string | null;
  eventName: string | null;
  actor: { kind: 'TEAM' | 'PLATFORM' | 'GUEST' | 'SYSTEM'; name: string | null };
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityPage {
  rows: ActivityRow[];
  hasMore: boolean;
  nextBefore: string | null;
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

export interface BeneficiaryAccount {
  id: string;
  label: string;
  upiId: string;
  payeeName: string;
  bankName: string | null;
  accountLast4: string | null;
  status: 'UNCONFIRMED' | 'CONFIRMED' | 'DISABLED';
  confirmedAt: string | null;
  createdAt: string;
  _count: { paymentConfigs: number; statementImports: number };
}

export interface EventPaymentConfig {
  id: string;
  version: number;
  upiIdSnapshot: string;
  payeeNameSnapshot: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  beneficiaryAccount: { id: string; label: string; status: string };
  _count: { entries: number };
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
  const acting = actingWorkspace.get();
  if (acting) headers['X-Workspace-Id'] = acting.id;

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
    // The API holds an issued password at the change form; send the user
    // there rather than showing a bare "forbidden" on whatever page they hit.
    if (
      response.status === 403 &&
      parsed?.error === 'PASSWORD_CHANGE_REQUIRED' &&
      !location.pathname.startsWith('/change-password')
    ) {
      location.assign('/change-password');
    }
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
    request<{ ok: boolean; profile: AdminProfile }>('/admin/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),

  activity: (params: { eventId?: string; before?: string; limit?: number }) =>
    request<ActivityPage>('/admin/activity' + query(params)),

  platform: {
    overview: () => request<PlatformWorkspace[]>('/admin/platform/overview'),

    provisionOrganizer: (payload: {
      organizerName: string;
      organizerEmail: string;
      organizerPhone?: string;
      workspaceName?: string;
      eventName: string;
      eventDate: string;
      hostName?: string;
      venue?: string;
      upiId: string;
      payeeName: string;
      /** Left out: the server generates one. */
      password?: string;
    }) =>
      request<ProvisionResult>('/admin/platform/organizers', { method: 'POST', body: payload }),

    addEvent: (
      workspaceId: string,
      payload: {
        eventName: string;
        eventDate: string;
        hostName?: string;
        venue?: string;
        upiId?: string;
        payeeName?: string;
      },
    ) =>
      request<PlatformEvent>('/admin/platform/workspaces/' + workspaceId + '/events', {
        method: 'POST',
        body: payload,
      }),

    /** Leave password out to have one generated. */
    resetPassword: (userId: string, password?: string) =>
      request<{ user: { id: string; name: string; email: string }; password: string }>(
        '/admin/platform/users/' + userId + '/reset-password',
        { method: 'POST', body: password ? { password } : {} },
      ),

    setUserActive: (userId: string, isActive: boolean) =>
      request<{ id: string; isActive: boolean }>('/admin/platform/users/' + userId, {
        method: 'PATCH',
        body: { isActive },
      }),

    setWorkspaceStatus: (workspaceId: string, status: 'ACTIVE' | 'SUSPENDED', reason?: string) =>
      request<{ id: string; status: string }>('/admin/platform/workspaces/' + workspaceId, {
        method: 'PATCH',
        body: { status, reason },
      }),
  },

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

  beneficiaries: () => request<BeneficiaryAccount[]>('/admin/beneficiaries'),

  createBeneficiary: (body: {
    label: string;
    upiId: string;
    payeeName: string;
    bankName?: string;
    accountLast4?: string;
  }) => request<BeneficiaryAccount>('/admin/beneficiaries', { method: 'POST', body }),

  confirmBeneficiary: (id: string) =>
    request<BeneficiaryAccount>('/admin/beneficiaries/' + id + '/confirm', { method: 'POST' }),

  selectEventBeneficiary: (eventId: string, beneficiaryAccountId: string) =>
    request<EventPaymentConfig>('/admin/beneficiaries/events/' + eventId + '/select', {
      method: 'POST',
      body: { beneficiaryAccountId },
    }),

  eventBeneficiaryHistory: (eventId: string) =>
    request<EventPaymentConfig[]>('/admin/beneficiaries/events/' + eventId + '/history'),

  /**
   * The statement has to say which account it came from: that is what
   * decides which contributions its credits may settle.
   */
  importStatement: (
    file: File,
    beneficiaryAccountId: string,
    eventId: string,
    autoReconcile: boolean,
    force = false,
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('beneficiaryAccountId', beneficiaryAccountId);
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
