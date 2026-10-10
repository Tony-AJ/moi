# MoiLedger — Digital Moi Management System

A digital *Moi* (gift/contribution) register for weddings and family functions.
Guests scan an event QR code, record their contribution and pay by UPI with the
amount prefilled. The organizer verifies every contribution by reconciling the
bank statement, then exports the register as Excel or PDF.

**Core rule of the system:** a guest can *initiate* a payment and *claim* a
transaction reference, but only reconciliation against trusted bank records (or
an explicit admin attestation for cash) can mark a contribution `VERIFIED`.
The API never accepts a client-supplied "paid" flag.

---

## Repository layout

```
moi-ledger/
├── apps/
│   ├── api/         NestJS + Prisma backend (validation, reconciliation, exports)
│   ├── guest-web/   Public React app opened from the event QR code
│   └── admin-web/   Protected React dashboard for the organizer
├── docs/            Architecture, API reference, test plan, deployment notes
└── infra/           Local Postgres via Docker Compose
```

## Stack

| Layer | Technology |
| --- | --- |
| Guest & admin web | React 18 + Vite + TypeScript |
| Backend | NestJS 10 + TypeScript |
| Database | PostgreSQL 16 + Prisma 5 |
| Admin auth | JWT bearer tokens, bcrypt password hashes |
| UPI payment | `upi://pay` intent deep link with prefilled amount |
| Reconciliation | CSV/XLSX statement import + reference/amount/date matching |
| Exports | ExcelJS (xlsx), PDFKit (pdf) |

## Quick start

Prerequisites: Node 20+, pnpm 9+, Docker (or any reachable PostgreSQL 14+).

```bash
pnpm install

# 1. Postgres on localhost:5433
pnpm db:up

# 2. Configure the API (edit the UPI id + secrets)
cp apps/api/.env.example apps/api/.env

# 3. Schema + demo data
pnpm --filter @moi/api prisma:migrate
pnpm db:seed

# 4. Run everything (api :4000, guest :5173, admin :5174)
pnpm dev
```

Health check: <http://localhost:4000/api/health>

Seeded login: `admin@moiledger.local` / `ChangeMe#123` (change it immediately —
`POST /api/admin/auth/change-password`).

Seeded guest page: <http://localhost:5173/e/kumar-wedding-2026>

### Try the whole flow locally

1. Open the guest page, submit a name + amount, open the UPI step.
2. Submit any reference number, e.g. `412345678901`.
3. Sign in to the admin app, go to **Reconciliation**, select the event and
   import `apps/api/prisma/sample-bank-statement.csv`.
4. The entry whose reference appears in the statement flips to `VERIFIED`;
   ambiguous ones land in `REVIEW_REQUIRED`; re-importing the same file changes
   nothing.
5. Export the register from **Reports**.

## Payment status model

| Status | Meaning |
| --- | --- |
| `AWAITING_VERIFICATION` | Recorded, no verified match yet |
| `VERIFIED` | Matched to an incoming bank credit, or cash attested by an admin |
| `REVIEW_REQUIRED` | Duplicate or ambiguous match — a human decides |
| `NOT_FOUND` | No matching credit in the imported statements (may simply not have settled yet) |
| `REJECTED` | Organizer states the money never arrived |

## Environment variables

### `apps/api/.env`

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | API port (default 4000) |
| `CORS_ORIGINS` | Comma-separated allowed origins (guest + admin) |
| `JWT_SECRET` | Admin token signing key, 32+ chars (required) |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `12h` |
| `DEFAULT_UPI_ID` / `DEFAULT_UPI_PAYEE_NAME` | Fallback UPI payee when an event has none |
| `GUEST_WEB_URL` | Public guest base URL; the QR code is built from it |
| `SEED_ADMIN_*` | Bootstrap admin for `pnpm db:seed` |

### `apps/guest-web/.env`, `apps/admin-web/.env`

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | e.g. `http://localhost:4000/api` |

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | API + both web apps in parallel |
| `pnpm dev:api` / `dev:guest` / `dev:admin` | One app at a time |
| `pnpm db:up` / `db:down` | Local Postgres container |
| `pnpm db:migrate` | Prisma migrate dev |
| `pnpm db:seed` | Bootstrap admin, demo event and entries |
| `pnpm build` | Build all three apps |

## Documentation

- [docs/architecture.md](docs/architecture.md) — data model, flows, decisions
- [docs/api.md](docs/api.md) — endpoint reference
- [docs/testing.md](docs/testing.md) — failure scenarios to verify
- [docs/deployment.md](docs/deployment.md) — production checklist

## Security posture

- All validation is server side; `whitelist` + `forbidNonWhitelisted` DTOs.
- Guest entries are addressed by an opaque 24-char token, never a database id.
- A UTR is globally unique, so one reference cannot be claimed twice.
- A bank transaction can verify at most one entry (DB-level unique + conditional update).
- Re-importing the same statement file or row changes nothing (file and row hashes).
- Rate limits on entry creation, reference submission and admin login.
- Audit log for every verification, rejection, import and export.
- The app never asks for a UPI PIN, OTP or bank password.
