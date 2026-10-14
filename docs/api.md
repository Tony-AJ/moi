# MoiLedger API reference

Written for: developers integrating with or extending the API.

Base path: `/api`. All request and response bodies are JSON unless stated.
Money is always integer **paise**.

Admin routes require `Authorization: Bearer <jwt>`. Validation is strict:
unknown properties are rejected (`400`).

---

## Public (guest) endpoints

### `GET /events/:slug`
Public event info for the guest form.

```json
{
  "slug": "kumar-wedding-2026",
  "name": "Kumar & Priya Wedding Reception",
  "hostName": "Kumar Family",
  "eventDate": "2026-11-21T10:00:00.000Z",
  "venue": "Sri Krishna Mahal, Coimbatore",
  "suggestedAmounts": [50000, 100000, 200000, 500000],
  "minAmountPaise": 100,
  "maxAmountPaise": 10000000,
  "collectPhone": true,
  "requirePhone": false,
  "isOpen": true,
  "upiConfigured": true,
  "payeeName": "Kumar Family"
}
```

No guest data and no totals are exposed here.

### `POST /events/:slug/entries`
Creates a Moi entry. Rate limit: 10/min per IP.

```json
{
  "guestName": "Arun Kumar",
  "guestAddress": "Coimbatore",
  "guestPhone": "9876543210",
  "relation": "Friend",
  "amountPaise": 100000,
  "paymentMethod": "UPI",
  "clientRequestId": "b0f3...idempotency-key",
  "note": "optional"
}
```

Returns the entry view with `accessToken`, `entryCode` and the UPI handoff:

```json
{
  "entryCode": "MOI-000006",
  "accessToken": "FGJN8VRUXFEA3RXHPAKU7KBU",
  "amountPaise": 100000,
  "amountDisplay": "₹1,000.00",
  "paymentStatus": "AWAITING_VERIFICATION",
  "upi": {
    "payeeVpa": "yourname@okicici",
    "amountRupees": "1000.00",
    "upiLink": "upi://pay?pa=...&am=1000.00&cu=INR&tn=Moi+MOI-000006&tr=MOI-000006",
    "appLinks": { "gpay": "tez://upi/pay?...", "phonepe": "phonepe://pay?...", "paytm": "paytmmp://pay?..." },
    "disclaimer": "Approve the payment inside your UPI app..."
  },
  "possibleDuplicate": false
}
```

Errors: `400` validation or amount outside the event limits · `403` event
closed · `404` unknown slug. Re-posting the same `clientRequestId` returns the
original entry with `"deduplicated": true`.

### `GET /entries/:token/status`
Entry status by opaque token, including claimed references.

### `POST /entries/:token/payment-reference`
Records a claimed UPI reference. Rate limit: 10/min.

```json
{ "utr": "412345678901" }
```

The status stays `AWAITING_VERIFICATION` — a claim is never proof of payment.
Matching runs opportunistically, so if the credit is already imported the
response may come back `VERIFIED`.

Errors: `409` the reference is already claimed on another entry · `400`
unusable reference · `404` unknown token.

---

## Admin: authentication

### `POST /admin/auth/login`
Rate limit: 5/min. `{ "email": "...", "password": "..." }` →
`{ "accessToken": "...", "admin": { "id", "email", "name", "role" } }`.
Unknown email and wrong password return the same `401`.

### `GET /admin/auth/me`
Current admin profile. The admin row is re-read on every request, so
deactivating an account revokes access immediately.

### First sign-in with an issued password

A login created or reset by a super admin has `mustChangePassword: true`.
Until the user changes it, every admin route except `GET /admin/auth/me` and
`POST /admin/auth/change-password` answers:

```json
{ "statusCode": 403, "error": "PASSWORD_CHANGE_REQUIRED", "message": "Choose a new password before continuing" }
```

`login` and `me` return `platformRole`, `mustChangePassword` and the active
`memberships` (`workspaceId`, `workspaceName`, `workspaceStatus`, `role`) so
the client can route to the platform console, the organizer workspace, or the
change form.

### `POST /admin/auth/change-password`
`{ "currentPassword": "...", "newPassword": "..." }` (min 10 chars).

---

## Platform (super admin)

Every route requires `platformRole = SUPER_ADMIN` (`403 Platform administrators
only` otherwise). None of them return guest names, amounts or totals; a
platform role still grants no read of a workspace's register.

### `GET /admin/platform/overview`
Each workspace with its active logins and its events:

```json
[{
  "id": "...", "name": "Kumar Family", "status": "ACTIVE",
  "members": [{ "id": "...", "name": "Kumar Organizer", "email": "...", "role": "WORKSPACE_OWNER",
                "isActive": true, "mustChangePassword": false, "lastLoginAt": "..." }],
  "events": [{ "id": "...", "name": "...", "eventDate": "...", "isOpen": true,
               "paymentReady": false, "entryCount": 12, "lastActivityAt": "...", "guestUrl": "..." }]
}]
```

`paymentReady` is false until the organizer has added, confirmed and selected
their own UPI account.

### `POST /admin/platform/organizers`
Creates the workspace, the event and the organizer login in one transaction.

```json
{
  "organizerName": "Kumar Organizer",
  "organizerEmail": "kumar@example.com",
  "organizerPhone": "98765 43210",
  "eventName": "Kumar & Priya Wedding Reception",
  "eventDate": "2026-12-05T10:00:00.000Z",
  "hostName": "Kumar Family",
  "venue": "Sri Krishna Mahal"
}
```

Returns `workspace`, `event` (with `guestUrl`), `organizer` and
`temporaryPassword` (e.g. `Kq7M-x3Pa-9WtZ`). The password is returned only
here, stored only as a bcrypt hash, and never written to the audit log.
`409` when the email already has a login — add an event to that organizer's
workspace instead.

### `POST /admin/platform/workspaces/:workspaceId/events`
`{ "eventName", "eventDate", "hostName?", "venue?" }` — another event for an
existing organizer, visible to them immediately with their existing login.

### `PATCH /admin/platform/workspaces/:workspaceId`
`{ "status": "SUSPENDED", "reason": "..." }` or `{ "status": "ACTIVE" }`.
Suspending closes the guest form on every event in the workspace and refuses
its members' admin requests. Nothing is deleted. `reason` is required to
suspend.

### `POST /admin/platform/users/:userId/reset-password`
Returns `{ user, temporaryPassword }`. The previous password stops working at
once, and sessions already open are held at the change-password form.
`400` for your own account, `403` for another super admin.

### `PATCH /admin/platform/users/:userId`
`{ "isActive": false }` disables the login; the next request with any of its
tokens gets `401`. Same restrictions as reset.

---

## Admin: activity

### `GET /admin/activity`
Query: `eventId?`, `before?` (ISO timestamp cursor), `limit?` (1–200, default 50).

```json
{
  "rows": [{
    "id": "...", "action": "ENTRY_CREATED_CASH_CONFIRMED", "eventId": "...", "eventName": "...",
    "actor": { "kind": "TEAM", "name": "Kumar Organizer" },
    "metadata": { "entryCode": "MOI-000002", "amountPaise": 250000 },
    "createdAt": "..."
  }],
  "hasMore": true,
  "nextBefore": "2026-10-14T09:12:44.120Z"
}
```

`actor.kind` is `TEAM`, `PLATFORM` (a super admin action), `GUEST` or
`SYSTEM`. Owners see every row in their workspace; event staff see only rows
for events they are assigned to. A requested `eventId` outside the caller's
access is `403`. Guest IP addresses are never returned.

---

## Admin: events

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/admin/events` | All events with per-status totals and `guestUrl` |
| `GET` | `/admin/events/:id` | One event |
| `POST` | `/admin/events` | `OWNER` only. Slug auto-derived from the name if omitted |
| `PATCH` | `/admin/events/:id` | `OWNER` only. Includes `isOpen` to close entries |

`guestUrl` is built from `GUEST_WEB_URL` and is what the QR code encodes.

---

## Admin: entries

### `GET /admin/entries`
Filters: `eventId`, `q` (name, address, phone, entry code, UTR), `status`
(comma separated), `paymentMethod`, `minAmountPaise`, `maxAmountPaise`,
`dateFrom`, `dateTo`, `page`, `pageSize` (max 200), `sortBy`
(`createdAt|amountPaise|guestName|entryNumber`), `sortDir`.

Returns `{ page, pageSize, total, totalPages, filteredSumPaise, rows }`.

### `GET /admin/stats?eventId=`
Dashboard counters: `totalEntries`, `submittedPaise`, `verifiedPaise`,
`verifiedCount`, `awaitingCount`, `reviewCount`, `notFoundCount`,
`rejectedCount`, `byStatus`, `byMethod`, `topEntries`.

### `GET /admin/entries/duplicates?eventId=`
Groups of entries sharing a guest name and amount within the event.

### `GET /admin/entries/:id`
Full entry with claims, matched credits, and who recorded or verified it.

### `POST /admin/entries`
Admin-recorded entry (cash in hand, or a guest who could not use the form).

```json
{
  "eventId": "...",
  "guestName": "Meena Rajan",
  "amountPaise": 500000,
  "paymentMethod": "CASH",
  "confirmReceived": true
}
```

`confirmReceived` only applies to `CASH`; it marks the entry `VERIFIED` and
attributes the attestation to the signed-in admin. Electronic methods always
start unverified.

### `POST /admin/entries/:id/payment-reference`
`{ "utr": "..." }` — records a reference the guest passed on by phone, then
immediately re-runs matching for that entry.

### `POST /admin/entries/:id/review`
Resolves a review. `reason` is mandatory and lands in the audit log.

```json
{ "action": "MATCH_TRANSACTION", "bankTransactionId": "...", "reason": "Confirmed with passbook" }
```

| Action | Effect |
| --- | --- |
| `MATCH_TRANSACTION` | Links that credit and sets `VERIFIED`. Requires equal amounts, a CREDIT direction and an unmatched transaction |
| `CONFIRM_CASH` | Cash entries only — `VERIFIED` by admin attestation |
| `REJECT` | `REJECTED`, unlinks any matched credit so it can be reused |
| `RESET` | Back to `AWAITING_VERIFICATION`, unlinks any matched credit |

Errors: `409` that credit is already matched elsewhere · `400` amount mismatch
or a debit row.

---

## Admin: bank statements

### `POST /admin/bank-statements/import`
`multipart/form-data`: `file` (CSV/XLSX, ≤10 MB), `eventId`,
`autoReconcile` (`true`/`false`), `force` (`true` to re-import a known file).

Returns the import record, the detected column mapping, a summary
(`parsedRows`, `importedRows`, `duplicateRows`, `skippedRows`, `credits`,
`debits`), up to 25 skipped-row reasons, and the reconciliation summary when
`autoReconcile=true`.

Errors: `409` this exact file was already imported (nothing changed) · `400`
no header row found, or no usable transactions.

### `GET /admin/bank-statements/imports?eventId=`
Import history with row counts and who uploaded each file.

### `GET /admin/bank-statements/transactions`
Filters: `eventId`, `importId`, `direction`, `matched` (`true|false`), `q`,
`page`, `pageSize`.

---

## Admin: reconciliation

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/admin/reconciliation/run` | `{ eventId, dateWindowDaysBefore?, dateWindowDaysAfter?, enableAmountFallback? }` |
| `POST` | `/admin/reconciliation/entries/:entryId/run` | Re-match a single entry |
| `GET` | `/admin/reconciliation/entries/:entryId/candidates` | Unmatched credits near that entry, flagged `amountMatches` / `referenceMatches` |

Run summary:

```json
{
  "scannedEntries": 5,
  "verified": 2,
  "reviewRequired": 3,
  "notFound": 0,
  "unchanged": 0,
  "results": [
    { "entryCode": "MOI-000001", "status": "VERIFIED", "previousStatus": "AWAITING_VERIFICATION", "changed": true, "reason": "Matched bank credit by reference 412345678901" }
  ]
}
```

---

## Admin: reports

### `GET /admin/reports/export?format=xlsx|pdf`
Accepts the same filters as `GET /admin/entries`. Returns a binary attachment.

- **xlsx** — `Summary` sheet (event meta, verified vs pending totals) plus the
  full `Moi Register` sheet with auto-filter and total rows.
- **pdf** — printable register with a summary block, the full table and the
  verified total stated separately from submitted claims.

---

## Health

### `GET /health`
`{ "status": "ok", "database": "up", ... }`. `status` is `degraded` when the
database check fails.
