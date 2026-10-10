# MoiLedger architecture

Written for: developers working on this repository.

## 1. System shape

```
  Event QR code ──▶ Guest web (React)        Admin web (React)
                         │                         │
                         └────── HTTPS JSON ───────┘
                                    │
                           NestJS API (apps/api)
                 validation · UPI handoff · reconciliation
                      auth · reports · audit logging
                                    │
                             PostgreSQL (Prisma)
```

Two separate frontends, one backend, one database. The guest app is public and
unauthenticated; every `/api/admin/*` route is closed by a JWT guard.

## 2. Data model

| Table | Purpose |
| --- | --- |
| `events` | Event name, date, venue, QR slug, UPI payee, amount limits, open/closed |
| `admin_users` | Organizer accounts (`OWNER` / `STAFF`), bcrypt hashes |
| `moi_entries` | Guest details, amount in paise, method, verification status, opaque access token |
| `payment_claims` | Claimed UPI references (UTRs), globally unique, history preserved |
| `bank_statement_imports` | One row per imported file, with the file hash |
| `bank_transactions` | Parsed statement rows, with a row hash and at most one matched entry |
| `audit_logs` | Every login, verification, rejection, import and export |

```
Event
 └── MoiEntry (MOI-000123, per-event sequence)
       ├── PaymentClaim (claimed UTR)        ──┐
       └── BankTransaction (matched credit)  ──┴─ 1:1 link on verification
```

### Decisions worth knowing

- **Money is integer paise.** No floats anywhere, including the statement parser.
- **Entry numbering** uses an atomic `entrySequence` counter on `events`
  incremented inside the same transaction that creates the entry, so codes are
  gap-free and unique per event even under concurrent submits.
- **Guests are addressed by `accessToken`** (24 chars, unambiguous alphabet),
  not by database id, so the public status endpoint leaks nothing.
- **`payment_claims.utrNormalized` is globally unique.** The same reference can
  never be claimed against two entries — the second attempt gets `409`.
- **`bank_transactions.matchedEntryId` is unique**, and matching is applied with
  a conditional `updateMany ... WHERE matchedEntryId IS NULL`. Two concurrent
  verifications cannot consume the same credit.
- **Idempotency**: `(eventId, clientRequestId)` is unique, so a double-tapped
  guest form returns the original entry instead of creating a duplicate.
- **File and row hashes**: re-uploading the same statement is rejected (`409`,
  overridable with `force=true`), and identical rows across overlapping
  statements are ignored by the `rowHash` unique index.

## 3. Verification state machine

```
                    ┌──────────── guest submits entry ───────────┐
                    ▼                                            │
          AWAITING_VERIFICATION ──── reconciliation run ──────────┤
            │        │        │                                   │
   single   │        │ many   │ none                              │
   ref      │        │ refs   │                                   │
   match    ▼        ▼        ▼                                   │
        VERIFIED  REVIEW_REQUIRED  NOT_FOUND ─── re-run ──────────┘
                      │
       admin links a specific credit, or rejects
                      ▼
              VERIFIED / REJECTED
```

Rules enforced in `ReconciliationService`:

1. Only an unmatched **CREDIT** can verify an entry.
2. The credited amount must equal the entry amount **exactly**.
3. The transaction date must fall in the window (default `-2` / `+14` days
   around the entry).
4. A reference match with exactly one candidate → `VERIFIED`.
5. More than one candidate → `REVIEW_REQUIRED` (never auto-verified).
6. Amount+date only, without a reference match → `REVIEW_REQUIRED`, never
   `VERIFIED`.
7. `NOT_FOUND` is not a verdict about the guest — the statement may simply be
   incomplete. Re-running is always allowed.

Cash entries are excluded from reconciliation. They are verified by an explicit
admin attestation (`confirmReceived` at entry time, or the `CONFIRM_CASH`
review action), which is recorded in the audit log under that admin's id.

## 4. UPI handoff

`UpiService` builds a `upi://pay` intent link with `pa` (payee VPA), `pn`,
`am` (amount in rupees, 2 decimals), `cu=INR`, `tn` (note with the entry code)
and `tr` (the entry code). App-specific variants (`tez://`, `phonepe://`,
`paytmmp://`) are returned for browsers that need an explicit scheme.

What the handoff deliberately does **not** do: conclude anything about success.
A personal UPI ID gives no callback, so returning from the UPI app proves
nothing. The API has no endpoint that lets a client declare a payment complete.

## 5. Statement parsing

`StatementParserService` reads CSV and XLSX through ExcelJS and:

- scores the first 30 rows to find the real header row (bank exports carry
  account-summary preamble lines);
- maps header synonyms seen across Indian banks (Narration/Particulars/Remarks,
  Chq-Ref No/UTR, Withdrawal/Debit, Deposit/Credit, Dr/Cr indicator, Balance);
- parses Excel serial dates, `dd/mm/yyyy`, `dd-mm-yy`, `dd-MMM-yyyy` and ISO;
- derives direction from separate debit/credit columns, or from a single amount
  column plus a Dr/Cr indicator;
- normalizes the reference and, when the reference column is empty, falls back
  to the narration — which is where UPI UTRs usually sit;
- reports unreadable rows instead of silently dropping them.

## 6. Changes made to the original plan

These were implemented deliberately, with the reasoning:

1. **Cash contributions are first-class** (`paymentMethod`, `CONFIRM_CASH`).
   At a real Moi event a large share of contributions is cash in hand; a
   register that cannot hold them is not the register the family keeps. Cash is
   verified by admin attestation, never by the bank statement, and the
   attestation is attributed in the audit log.
2. **`POST /entries/:token/payment-reference` uses the opaque token**, not the
   entry id as originally sketched. Sequential or guessable ids on a public
   write endpoint would let anyone attach references to other guests' entries.
3. **Payments table became `payment_claims`** with history: a guest who pastes
   the wrong UTR can correct it, the old claim is kept as `SUPERSEDED`, and the
   unique index still blocks cross-entry reuse.
4. **Idempotency key on entry creation** rather than relying on the admin
   catching duplicates later.
5. **Statement file and row hashing** so "the same statement uploaded twice" is
   a non-event rather than a data-integrity problem.
6. **Opportunistic matching when a reference is submitted**: if the statement
   containing the credit was already imported, the guest sees `VERIFIED`
   immediately, with no weakening of the matching rules.
7. **QR URL comes from the API** (`GUEST_WEB_URL`), and the admin UI warns when
   it still points at localhost — the one mistake that would ruin printed QRs.
8. **Amount-only matches never auto-verify.** The original plan listed exact
   amount as a matching signal; on its own it is far too weak at an event where
   many guests give the same round number.

## 7. Known limits

- Reconciliation is per event and runs synchronously; fine for thousands of
  entries, not for lakhs. Move to a queue if that changes.
- No partial-payment support: one credit verifies one entry in full.
- Admins are global, not scoped per event.
- No automatic payment-status integration. That requires either a payment
  gateway or a bank API, and is intentionally out of scope for v1.
