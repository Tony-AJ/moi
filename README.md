# MoiLedger — Digital Moi Management & Reconciliation System

A production-grade digital *Moi* (traditional gift/contribution) register and verification system for Indian weddings, family functions, and ceremonies. 

Guests scan an event QR code, fill in their contribution details, and initiate a UPI payment with the exact amount and reference prefilled. Organizers verify every electronic contribution with zero-trust integrity by reconciling exported bank statements against claimed transaction references, attest cash contributions in hand, and export the finalized register to Excel and printable PDF.

> **The Zero-Trust Core Rule of MoiLedger:**  
> A guest can *initiate* a payment and *claim* a transaction reference (UTR), but **only automated reconciliation against verified bank statements** (or an explicit, authenticated admin attestation for cash) can transition a contribution to `VERIFIED`. The API never accepts a client-supplied "paid" flag.

---

## Table of Contents

1. [System Architecture & Monorepo Layout](#system-architecture--monorepo-layout)
2. [What Has Been Done (Completed Features)](#what-has-been-done-completed-features)
   - [NestJS Backend Engine](#1-nestjs-backend-engine-appsapi)
   - [Public Guest Web Application](#2-public-guest-web-application-appsguest-web)
   - [Admin Organizer Dashboard](#3-admin-organizer-dashboard-appsadmin-web)
   - [Database, Storage & Integrity Layer](#4-database-storage--integrity-layer)
3. [All Included Services & Port Matrix](#all-included-services--port-matrix)
4. [Prerequisites](#prerequisites)
5. [Step-by-Step Setup & How to Run All Services](#step-by-step-setup--how-to-run-all-services)
   - [Quick Start (All Services Together)](#quick-start-all-services-together)
   - [Running Services Individually](#running-services-individually)
   - [Database Management Commands](#database-management-commands)
6. [Roles: Super Admin and Event Organizers](#roles-super-admin-and-event-organizers)
7. [End-to-End Workflow](#end-to-end-workflow)
   - [Phase 1: Event Setup & QR Deployment](#phase-1-event-setup--qr-deployment)
   - [Phase 2: Guest Experience & UPI Payment](#phase-2-guest-experience--upi-payment)
   - [Phase 3: Statement Import & Automated Reconciliation](#phase-3-statement-import--automated-reconciliation)
   - [Phase 4: Ambiguity Resolution & Cash Attestation](#phase-4-ambiguity-resolution--cash-attestation)
   - [Phase 5: Auditing, Export & Closure](#phase-5-auditing-export--closure)
8. [Payment Lifecycle & State Machine](#payment-lifecycle--state-machine)
9. [Reconciliation & Statement Matching Engine](#reconciliation--statement-matching-engine)
10. [Environment Configuration Reference](#environment-configuration-reference)
11. [API Reference Summary](#api-reference-summary)
12. [Security, Integrity & Fraud Prevention](#security-integrity--fraud-prevention)
13. [Verification & Testing Checklist](#verification--testing-checklist)

---

## System Architecture & Monorepo Layout

MoiLedger is designed as a TypeScript monorepo using **pnpm workspaces**:

```
moi-ledger/
├── apps/
│   ├── api/             # NestJS 10 + Prisma 5 backend service (:4000)
│   │   ├── prisma/      # Schema, migrations, seed script & sample statement
│   │   └── src/         # Core domain modules (auth, entries, recon, reports, etc.)
│   ├── guest-web/       # Public mobile-optimized React 18 + Vite app (:5173)
│   │   └── src/         # Event landing, dynamic forms, UPI handoff, status polling
│   └── admin-web/       # Organizer dashboard React 18 + Vite app (:5174)
│       └── src/         # Metrics, entry ledger, statement upload, review queue, reports
├── docs/                # Architectural RFCs, API specs, deployment & test guides
│   ├── api.md           # Exhaustive endpoint reference and payloads
│   ├── architecture.md  # Architectural decisions, invariants, and data models
│   ├── deployment.md    # Production checklist and scaling guidelines
│   └── testing.md       # 35+ verified failure scenarios and edge cases
├── infra/               # Local infrastructure
│   └── docker-compose.yml # Containerized PostgreSQL 16 Alpine (:5433)
├── package.json         # Workspace root scripts
├── pnpm-workspace.yaml  # Workspace directory definitions
└── README.md            # Project documentation (this file)
```

```
                     ┌────────────────────────────────────────────────────────┐
                     │                 Event QR Code Standee                  │
                     └───────────────────────────┬────────────────────────────┘
                                                 │ Scanned by phone
                                                 ▼
┌─────────────────────────────────┐                             ┌─────────────────────────────────┐
│     Guest Web App (:5173)       │                             │     Admin Web App (:5174)       │
│  - Event details & custom gift  │                             │  - Organizer control dashboard  │
│  - Prefilled UPI intent links   │                             │  - Bank statement CSV/XLSX drop │
│  - Claim UTR / status tracking  │                             │  - Interactive Review Queue     │
└────────────────┬────────────────┘                             └────────────────┬────────────────┘
                 │                                                               │
                 │ HTTPS JSON                                                    │ Bearer JWT
                 └───────────────────────────────┬───────────────────────────────┘
                                                 ▼
                              ┌─────────────────────────────────────┐
                              │         NestJS API (:4000)          │
                              │  - Server-side DTO sanitization     │
                              │  - Strict paise integer math        │
                              │  - Automated reconciliation engine  │
                              │  - ExcelJS & PDFKit report streams  │
                              │  - Rate limiting & full audit trails│
                              └──────────────────┬──────────────────┘
                                                 │
                                                 ▼
                              ┌─────────────────────────────────────┐
                              │     PostgreSQL 16 DB (:5433)        │
                              │  - Gap-free sequential numbering    │
                              │  - Global UTR uniqueness            │
                              │  - File & row SHA-256 deduplication │
                              │  - 1:1 Bank Credit conditional locks│
                              └─────────────────────────────────────┘
```

---

## What Has Been Done (Completed Features)

### 1. NestJS Backend Engine (`apps/api`)
- **Strict Integer Money**: All transactions, limits, and records are tracked in integer **paise** (1 INR = 100 paise) preventing floating-point rounding errors.
- **Atomic Entry Numbering**: Every event has an atomic `entrySequence` counter incremented in the same database transaction as the entry creation, generating human-readable codes like `MOI-000001` with zero gaps.
- **Idempotency Safeguard**: Supports `clientRequestId` unique constraint per event to prevent duplicate entries when mobile users double-tap buttons on flaky connections.
- **Opaque Access Tokens**: Guests receive an unguessable 24-character cryptographic token (`accessToken`) using an unambiguous alphabet. Database IDs are never exposed over public endpoints.
- **Smart Statement Parser (`StatementParserService`)**:
  - Handles both `.csv` and `.xlsx` (Excel) bank statements.
  - Scores the first 30 rows to detect the true header row, skipping bank preambles and account metadata.
  - Understands Indian bank terminology synonyms (Narration, Description, Chq/Ref No, UTR, Withdrawal/Debit, Deposit/Credit, Cr/Dr flags).
  - Robust date parsing supporting Excel serial dates, `dd/mm/yyyy`, `dd-mm-yy`, `dd-MMM-yyyy`, and ISO formats.
  - SHA-256 file hashing blocks re-importing the same statement (`409 Conflict`), with an optional `force=true` override.
  - SHA-256 row hashing (`rowHash`) ignores overlapping duplicate rows across multiple statements.
- **Reconciliation Engine (`ReconciliationService`)**:
  - Multi-tier matching: compares transaction credits, exact paise amounts, and normalized UTRs against both the reference column and the narration string.
  - Date window verification (configurable, default `-2` to `+14` days).
  - Single exact match transitions entry to `VERIFIED`.
  - Ambiguous matches (multiple candidates or amount-only matches without UTR) are tagged as `REVIEW_REQUIRED`.
  - Unmatched entries stay `NOT_FOUND` without penalizing the guest.
  - Concurrency-safe: Database unique constraint on `matchedEntryId` plus conditional update logic ensures two verifications cannot consume the same bank credit.
- **Reporting Engine (`ReportsService`)**:
  - **Excel Export**: Generates `.xlsx` spreadsheets via ExcelJS with a formatted `Summary` sheet and a structured `Moi Register` sheet complete with auto-filters and formulas.
  - **PDF Export**: Generates clean, printable `.pdf` registries via PDFKit with formal header blocks, paginated records, and clear separation between verified cash/bank totals and unverified claims.
- **Security & RBAC**:
  - JWT authentication for admin routes with `OWNER` and `STAFF` role separation.
  - Self-service password changes (`POST /api/admin/auth/change-password`).
  - Strict input validation via `class-validator` with `whitelist: true` and `forbidNonWhitelisted: true`.
  - Rate limiting via `@nestjs/throttler` (entry creations: 10/min, UTR claims: 10/min, login: 5/min).
  - Complete immutable audit logging (`AuditLog`) for every administrative login, cash confirmation, manual match, rejection, and report export.

### 2. Public Guest Web Application (`apps/guest-web`)
- **Fast, Mobile-First Web Experience**: Built on Vite + React 18, tailored for smartphones scanning event QR codes at entrance reception desks.
- **Public Event View (`/e/:slug`)**: Displays host name, event date, venue, and configured contribution limits.
- **Adaptive Entry Form**:
  - Quick-pick amount chips (e.g., ₹500, ₹1,000, ₹2,000, ₹5,000) alongside custom input.
  - Configurable attendee phone number collection.
  - Relation, address, and personal blessing note fields.
  - Automatic client-side UUID generation for transaction idempotency.
- **Direct UPI Payment Handoff**:
  - Dynamic `upi://pay` deep link generation with prefilled beneficiary VPA, payee name, amount, note, and transaction reference.
  - Direct app launcher buttons for **Google Pay** (`tez://`), **PhonePe** (`phonepe://`), and **Paytm** (`paytmmp://`).
  - Copyable UPI URL and clear step-by-step guidance.
- **Self-Service Reference Claiming**:
  - Form for submitting the 12-digit bank reference (UTR).
  - Immediate optimistic reconciliation: if the statement was already imported, the guest immediately sees `VERIFIED`.
- **Live Status Tracker (`/status/:token`)**:
  - Real-time entry status view with status badges, receipt code, copyable receipt link, and clear status explanations.

### 3. Admin Organizer Dashboard (`apps/admin-web`)
- **Organized Navigation & Layout**: Collapsible, responsive interface with role display and quick logout.
- **Analytics Dashboard (`/dashboard`)**:
  - Real-time KPI summary: Total contributions, total submitted amount, verified funds, pending count, review count, and rejected count.
  - Visual breakdown by payment status and payment method.
  - Top contributors leaderboard.
- **Event Management (`/events`)**:
  - Create and configure multiple events (date, venue, host name, custom slug).
  - Beneficiary UPI ID and Payee Name configuration with inheritance from system defaults.
  - Quick-pick amount chip setup and phone collection enforcement.
  - Master `isOpen` toggle to freeze contributions when the event concludes.
  - Built-in QR Code Generator modal with quick download and warning alerts if pointing to a non-public localhost URL.
- **Entry Register & Cash Handling (`/entries`)**:
  - Searchable, filterable ledger with pagination, multi-status filters, and sorting.
  - Duplicate detection engine identifying potential accidental duplicate registrations.
  - `ManualEntryModal`: Facilitates on-the-spot recording of cash gifts handed over at the counter, with an immediate `confirmReceived` toggle that credits the gift and logs the admin's attestation.
  - `EntryDetailModal`: Detailed modal showing guest info, timeline, full UTR claims history, matched credit details, and audit records.
- **Reconciliation Center (`/reconciliation`)**:
  - Drag-and-drop bank statement uploader supporting `.csv` and `.xlsx` files up to 10 MB.
  - Automatic column auto-detection and reconciliation trigger upon upload.
  - Batch Reconciliation runner with customizable date match window (-X / +Y days) and amount-only fallback toggles.
  - **Interactive Review Queue**: Lists all `REVIEW_REQUIRED` entries side-by-side with candidate bank transactions for one-click manual linking, cash confirmation, rejection, or reset.
- **Reports & Export Center (`/reports`)**:
  - On-demand download of verified registers in `.xlsx` or `.pdf` format with custom date and status filters.

### 4. Database, Storage & Integrity Layer
- **PostgreSQL 16** containerized with native Alpine Linux image.
- **Prisma 5 ORM** schema modeling:
  - `Event`: Event properties, UPI configurations, sequence numbers.
  - `AdminUser`: Password hashes, roles, status.
  - `MoiEntry`: Contributions, access tokens, paise amounts, verification states.
  - `PaymentClaim`: Normalized UTR claims with global uniqueness and audit history (`CLAIMED`, `MATCHED`, `SUPERSEDED`, `REJECTED`).
  - `BankStatementImport`: Uploaded files with SHA-256 fingerprinting.
  - `BankTransaction`: Normalized statement rows with SHA-256 row fingerprinting and 1:1 conditional unique links.
  - `AuditLog`: Action tracking linking administrator IDs, entities, IPs, and timestamps.
- **Seed Script (`prisma/seed.ts`)**: Prepopulates bootstrap administrator, sample event (`kumar-wedding-2026`), and demo contributions.
- **Sample Statement (`prisma/sample-bank-statement.csv`)**: Ready-to-import bank statement with realistic UPI credits, narration patterns, and test transactions.

---

## All Included Services & Port Matrix

| Service | Technology | Port | URL | Description |
|---|---|---|---|---|
| **PostgreSQL Database** | PostgreSQL 16 (Docker) | `5433` (host) `5432` (internal) | `localhost:5433` | Primary relational database storing all entries, claims, statements, and audit trails. |
| **API Backend** | NestJS 10 + Prisma 5 | `4000` | `http://localhost:4000/api` | REST API handling auth, payments, parsing, reconciliation, and reports. |
| **Guest Web App** | React 18 + Vite | `5173` | `http://localhost:5173` | Mobile-first guest web portal for QR code scans, payments, and receipt tracking. |
| **Admin Web App** | React 18 + Vite | `5174` | `http://localhost:5174` | Secured dashboard for event hosts to manage entries, import statements, and run reconciliation. |

---

## Prerequisites

Before running the project, ensure you have the following installed on your machine:
- **Node.js**: `v20.x` or higher
- **pnpm**: `v9.x` or higher (`npm install -g pnpm`)
- **Docker & Docker Compose**: (Or an existing reachable PostgreSQL 14+ instance)

---

## Step-by-Step Setup & How to Run All Services

### Quick Start (All Services Together)

Follow these steps to spin up the entire system from scratch:

#### Step 1: Install workspace dependencies
Run from the root directory:
```bash
pnpm install
```

#### Step 2: Start the PostgreSQL database
Spin up the PostgreSQL 16 container via Docker Compose:
```bash
pnpm db:up
```
*Verify it is running: `docker ps` should show `moi-postgres` listening on port `5433`.*

#### Step 3: Configure environment variables
Copy the example environment files for the API and frontend applications:

```bash
# API environment
cp apps/api/.env.example apps/api/.env

# Guest web environment
cp apps/guest-web/.env.example apps/guest-web/.env

# Admin web environment
cp apps/admin-web/.env.example apps/admin-web/.env
```

*(On Windows PowerShell, use `copy apps\api\.env.example apps\api\.env` etc.)*

#### Step 4: Run Prisma migrations and seed demo data
Apply the database migrations and run the seed script:
```bash
# Run Prisma migrations
pnpm db:migrate

# Seed admin user, sample event, and demo entries
pnpm db:seed
```

#### Step 5: Start all services in parallel
Launch the NestJS API, Guest Web, and Admin Web concurrently:
```bash
pnpm dev
```

Once running:
- **API Health Check**: <http://localhost:4000/api/health>
- **Guest Web Portal**: <http://localhost:5173/e/kumar-wedding-2026>
- **Admin Dashboard**: <http://localhost:5174>
- **Default Seeded Logins** (password `ChangeMe#123` for all; change them):
  - **Super admin** (platform console, `/platform`): `super@moiledger.local`
  - **Organizer, Kumar family event**: `admin@moiledger.local`
  - **Organizer, Raman family event**: `priya@moiledger.local`

---

### Running Services Individually

If you prefer to run each service in a dedicated terminal window:

```bash
# Terminal 1: Run NestJS API backend (Port 4000)
pnpm dev:api

# Terminal 2: Run Guest Web frontend (Port 5173)
pnpm dev:guest

# Terminal 3: Run Admin Web dashboard (Port 5174)
pnpm dev:admin
```

---

### Database Management Commands

The root `package.json` provides handy shortcuts for all database and Prisma operations:

| Command | Action |
|---|---|
| `pnpm db:up` | Starts the Docker PostgreSQL container in background (`-d`). |
| `pnpm db:down` | Stops the Docker PostgreSQL container. |
| `pnpm db:migrate` | Runs `prisma migrate dev` on `@moi/api` to apply new migrations. |
| `pnpm db:seed` | Runs the database seed script to populate sample accounts and events. |
| `pnpm --filter @moi/api prisma:studio` | Launches Prisma Studio GUI (<http://localhost:5555>) to visually inspect database rows. |
| `pnpm --filter @moi/api prisma:generate` | Re-generates the Prisma Client artifacts. |
| `pnpm --filter @moi/api prisma:deploy` | Executes production migrations without modifying schema files. |

---

## Roles: Super Admin and Event Organizers

MoiLedger is run by one platform super admin for many families. The super
admin has full control; each organizer gets a login that sees only their own
events.

```
                           Super admin
   creates every event against an organizer, sets the organizer's UPI,
   issues logins, opens any register, reconciles, exports any report
                               |
            +------------------+------------------+
            |                                     |
   Event A organizer                     Event B organizer
   own workspace, own login              own workspace, own login
   edits event details                   edits event details
   register, reconcile, reports          register, reconcile, reports
            |                                     |
            +----- cannot see each other ---------+
```

| Who | Can | Cannot |
| --- | --- | --- |
| **Super admin** (`PlatformRole SUPER_ADMIN`) | Create events (only role that can), each in a chosen organizer's workspace; set and change the organizer's UPI account; issue, reset and disable logins; suspend/restore a workspace; see every event's totals; open any organizer's entries, reconciliation, activity and reports | Manage other super admins |
| **Organizer** (`WORKSPACE_OWNER`) | Edit their event details; record and verify entries; import statements; export reports; read their activity | Create events; add or change the UPI account; see any other organizer's event |
| **Event staff** (`EVENT_STAFF`) | Whatever their per-event grants allow, on assigned events only | Anything outside their assigned events |

**Setting up an organizer**

1. Super admin opens **Organizers & events** (`/platform`), enters the event, the organizer's name and email, and the organizer's **UPI ID**.
2. One step creates the organizer's workspace, the event, the confirmed UPI account, and the login. A **one-time password** is shown once with a ready-to-send message.
3. The organizer signs in and must set their own password before anything else opens (enforced by the API).
4. **Open register** puts the super admin inside that organizer's workspace (sent as the `X-Workspace-Id` header); **Excel / PDF** on each event row downloads its report directly.

The super admin account can read every family's guest list and money, and
decides where every event's payments go. Protect it with a long unique
password and keep the number of super admins small.

---

## End-to-End Workflow

Here is how the complete system functions from before the event until after the celebration:

```
[ Organizer ]                     [ Guest ]                     [ Bank / UPI ]
      │                              │                                │
      ├─ 1. Creates Event            │                                │
      ├─ 2. Prints Standee QR        │                                │
      │                              │                                │
      │                              ├─ 3. Scans QR at reception      │
      │                              ├─ 4. Submits Name & Amount      │
      │                              ├─ 5. Taps GPay / PhonePe / UPI ─┼─▶ Pays ₹1,000
      │                              │                                │   (Gets UTR: 412345678901)
      │                              ├─ 6. Submits claimed UTR ───────┤
      │                              │  (Status: AWAITING_VERIFICATION)│
      │                              │                                │
(Later during/after event)           │                                │
      │                              │                                │
      ├─ 7. Downloads Statement CSV/XLSX ◀────────────────────────────┤
      ├─ 8. Uploads Statement in Admin Dashboard                      │
      ├─ 9. Reconciliation Auto-Matches Reference ────────────────────┤
      │  (Status flips to: VERIFIED) │                                │
      │                              ├─ 10. Checks status link ───────┤
      │                              │   (Sees: VERIFIED receipt)     │
      ├─ 11. Resolves Ambiguities in Review Queue                     │
      ├─ 12. Attests Cash entries in hand                             │
      └─ 13. Exports Final Register (Excel & PDF)                     │
```

### Phase 1: Event Setup & QR Deployment
1. The super admin creates the event against the organizer under **Organizers & events**, entering the organizer's UPI ID (e.g., `family@okicici`), and sends the organizer the one-time password.
2. The organizer signs in to the Admin Portal (`:5174`) and sets their own password.
3. Under **Event & QR → Edit details** they fill in the host name, venue, date, quick-pick amounts and phone requirements. The UPI account is shown read-only; only the super admin changes it.
5. The system produces a print-ready QR code that points to the public guest URL (`https://your-domain.com/e/kumar-wedding-2026`).
6. The QR standee is printed and placed at the entrance or dining hall gift desk.
7. Under **Activity**, the organizer can follow everything that happens on the event: registrations, references, verifications, imports, exports and changes.

### Phase 2: Guest Experience & UPI Payment
1. The guest scans the QR code on their smartphone; the Guest Web App (`:5173`) opens immediately.
2. The guest enters their name, city/address, relation, and selects or enters their contribution amount.
3. Upon submitting, the system atomically allocates an entry code (e.g., `MOI-000006`) and presents the UPI payment sheet.
4. The guest taps their preferred UPI app (**Google Pay**, **PhonePe**, **Paytm**, or **Any UPI App**).
5. The UPI app opens with payee name, UPI VPA, and amount prefilled, and the note set to `Moi MOI-000006`.
6. The guest approves the payment in their banking app and receives a 12-digit UPI reference number (UTR).
7. The guest switches back to the browser, pastes the 12-digit UTR, and submits it.
8. The entry status remains `AWAITING_VERIFICATION`. The guest can bookmark or copy their receipt link (`/status/:accessToken`).

### Phase 3: Statement Import & Automated Reconciliation
1. At periodic intervals during or after the event, the organizer downloads their bank account statement (`.csv` or `.xlsx`) from net banking.
2. In the Admin Dashboard, under **Reconciliation**, the organizer selects the event and uploads the statement.
3. The server validates file integrity (blocking exact re-uploads), skips preamble headers, normalizes rows, filters duplicate lines via `rowHash`, and records the bank credits.
4. The automated reconciliation engine evaluates all pending entries against the credits:
   - Matches with identical paise amounts and exact matching UTRs in either the reference column or narration string transition automatically to **`VERIFIED`**.
   - If the guest checks their status link, they instantly see their verified receipt badge.

### Phase 4: Ambiguity Resolution & Cash Attestation
1. If multiple transactions share the same reference or if an entry has an amount match without a UTR, it is placed in the **Review Queue** (`REVIEW_REQUIRED`).
2. The organizer reviews candidate transactions and clicks **Link Credit** (with an audited reason) to verify it.
3. For guests presenting cash envelopes in person:
   - The organizer opens **Manual Entry** on the dashboard.
   - Enters guest details, selects payment method **CASH**, and marks **"Confirm cash received in hand"**.
   - The entry is immediately marked **`VERIFIED`** and credited under that administrator's audit ID.

### Phase 5: Auditing, Export & Closure
1. The organizer closes the event toggle (`isOpen: false`) so no new submissions can be made.
2. Under **Reports**, the organizer downloads the final register:
   - **Excel (.xlsx)**: Complete spreadsheet with separate sheets for aggregate statistics and detailed line-item registers.
   - **PDF (.pdf)**: Formal, printable document showing verified electronic gifts and cash receipts, separated from unverified claims.

---

## Payment Lifecycle & State Machine

```
                            ┌─────────────────────────────────────────┐
                            │ Guest submits form / Admin manual entry │
                            └────────────────────┬────────────────────┘
                                                 │
                                                 ▼
                                     [ AWAITING_VERIFICATION ]
                                                 │
                                                 │
                  ┌──────────────────────────────┼──────────────────────────────┐
                  │                              │                              │
                  ▼ (Reconciliation)             ▼ (Ambiguity)                  ▼ (No statement match)
      [ Single UTR & Amount Match ]    [ Duplicate Ref / Amount-only ]     [ No Credit in Statement ]
                  │                              │                              │
                  ▼                              ▼                              ▼
            ( VERIFIED )                ( REVIEW_REQUIRED )                ( NOT_FOUND )
                  ▲                              │                              │
                  │                              ├─ Admin links credit ─────────┤
                  │                              │                              │
                  │                              ├─ Admin attests cash          │
                  │                              │                              │
                  │                              └─ Admin rejects ──────────────┼──────────┐
                  │                                                             │          │
                  │                                                             │          ▼
                  │                                                       Re-run recon ( REJECTED )
                  └─────────────────────────────────────────────────────────────┘
```

| Status | Definition | Transition Condition |
|---|---|---|
| `AWAITING_VERIFICATION` | Initial recorded state. | Entry created; waiting for bank statement reconciliation. |
| `VERIFIED` | Immutable proof of received funds. | Matched against an incoming bank credit (1:1), OR explicit admin cash attestation. |
| `REVIEW_REQUIRED` | Flagged for organizer inspection. | Multiple credits match the reference, or an exact amount match occurred with no UTR. |
| `NOT_FOUND` | No bank record matched yet. | Bank statement imported, but no matching credit was identified in that file (statement may be pending settlement). |
| `REJECTED` | Declared invalid or fraudulent. | Organizer explicitly verified that the money never arrived or was recalled. |

---

## Reconciliation & Statement Matching Engine

The reconciliation engine in [`apps/api/src/modules/reconciliation/reconciliation.service.ts`](apps/api/src/modules/reconciliation/reconciliation.service.ts) implements deterministic financial rules:

1. **Credit Direction Only**: Only incoming bank transactions marked `CREDIT` can verify a contribution. Debits and withdrawals are rejected immediately.
2. **Exact Integer Amount**: The credited transaction amount in paise must match the entry amount in paise **to the cent**. Partial payments or amount approximations are never auto-verified.
3. **Transaction Date Window**: Only transactions within a configurable date window around the entry date (default: `-2` days prior to `+14` days after) are considered candidates.
4. **Reference Matching (UTR)**:
   - Compares the guest's normalized UTR against the statement's reference column.
   - If the reference column is blank (common in Indian bank exports), the parser falls back to scanning the transaction narration string for the 12-digit numeric reference.
5. **Deduplication & Single Consumption**:
   - Every matched transaction has its `matchedEntryId` set in a unique constraint.
   - Matching executes with conditional updates (`WHERE matchedEntryId IS NULL`).
   - One bank transaction can verify **at most one** Moi entry.
6. **No Amount-Only Auto Verification**: If an entry has no claimed UTR, having an identical amount match on the same date will **never** mark it `VERIFIED`; it is moved to `REVIEW_REQUIRED` so a human decides.

---

## Environment Configuration Reference

### 1. Backend Service (`apps/api/.env`)

```ini
# PostgreSQL connection string (Docker default uses port 5433)
DATABASE_URL="postgresql://moi:moi_dev_password@localhost:5433/moi_ledger?schema=public"

# HTTP server settings
PORT=4000
NODE_ENV=development

# CORS: Comma-separated origins allowed to make API requests
CORS_ORIGINS="http://localhost:5173,http://localhost:5174"

# JWT configuration for Admin authentication (min 32 characters in production)
JWT_SECRET="change-me-in-production-min-32-chars-long"
JWT_EXPIRES_IN="12h"

# Seed bootstrap administrator credentials (used by pnpm db:seed)
SEED_ADMIN_EMAIL="admin@moiledger.local"
SEED_ADMIN_PASSWORD="ChangeMe#123"
SEED_ADMIN_NAME="Event Organizer"

# Base URL for public guest portal (used to construct event QR codes)
GUEST_WEB_URL="http://localhost:5173"

# System-wide fallback UPI beneficiary details
DEFAULT_UPI_ID="yourname@okicici"
DEFAULT_UPI_PAYEE_NAME="Your Name"

# Allowed contribution thresholds (in integer paise)
MIN_AMOUNT_PAISE=100         # ₹1.00
MAX_AMOUNT_PAISE=10000000    # ₹1,00,000.00
```

### 2. Guest Web Application (`apps/guest-web/.env`)

```ini
# Base URL pointing to the NestJS API
VITE_API_BASE_URL=http://localhost:4000/api
```

### 3. Admin Web Application (`apps/admin-web/.env`)

```ini
# Base URL pointing to the NestJS API
VITE_API_BASE_URL=http://localhost:4000/api

# Guest web portal URL used for QR code preview and links
VITE_GUEST_WEB_URL=http://localhost:5173
```

---

## API Reference Summary

All API endpoints are prefixed with `/api`. For exhaustive payloads, see [`docs/api.md`](docs/api.md).

### Public Endpoints (Guests)
- `GET /api/events/:slug` — Retrieve public event details, limits, and suggested amounts.
- `POST /api/events/:slug/entries` — Submit a new contribution entry (returns entry code, opaque token, and prefilled UPI links).
- `GET /api/entries/:token/status` — Look up entry verification status using the opaque 24-character token.
- `POST /api/entries/:token/payment-reference` — Submit or update the claimed 12-digit UTR reference.

### Admin Authentication
- `POST /api/admin/auth/login` — Sign in with email and password to obtain a Bearer JWT.
- `GET /api/admin/auth/me` — Retrieve the authenticated administrator's profile and permissions.
- `POST /api/admin/auth/change-password` — Update admin account password.

### Super Admin (platform) — `SUPER_ADMIN` only, no guest data
- `GET /api/admin/platform/overview` — Organizers, their logins and events, with counts and setup status only.
- `POST /api/admin/platform/organizers` — Create workspace + event + organizer login; returns a one-time password once.
- `POST /api/admin/platform/workspaces/:workspaceId/events` — Add another event to an existing organizer.
- `PATCH /api/admin/platform/workspaces/:workspaceId` — Suspend (with reason) or restore a workspace.
- `POST /api/admin/platform/users/:userId/reset-password` — Issue a new one-time password.
- `PATCH /api/admin/platform/users/:userId` — Disable or enable a login.

### Admin Activity
- `GET /api/admin/activity?eventId=&before=&limit=` — The organizer's audit trail, scoped to the events they may see.

### Admin Event Management
- `GET /api/admin/events` — List all events with aggregate totals and QR metadata.
- `POST /api/admin/events` — Create a new event (`OWNER` role only).
- `GET /api/admin/events/:id` — Retrieve single event details.
- `PATCH /api/admin/events/:id` — Update event configuration, UPI payee, or toggle `isOpen`.

### Admin Entry Management
- `GET /api/admin/entries` — Filtered, paginated list of entries (search by name, phone, UTR, code, or status).
- `GET /api/admin/stats` — High-level event summary metrics and breakdown counts.
- `GET /api/admin/entries/duplicates` — Detect identical guest submissions.
- `GET /api/admin/entries/:id` — View full entry details, history of claims, matched credits, and audit trail.
- `POST /api/admin/entries` — Record a manual entry (cash envelope or assisted registration).
- `POST /api/admin/entries/:id/payment-reference` — Attach a reference received over phone or SMS.
- `POST /api/admin/entries/:id/review` — Resolve review action (`MATCH_TRANSACTION`, `CONFIRM_CASH`, `REJECT`, `RESET`).

### Admin Bank Statements & Reconciliation
- `POST /api/admin/bank-statements/import` — Upload statement (`multipart/form-data`, `.csv` / `.xlsx`).
- `GET /api/admin/bank-statements/imports` — View statement upload history.
- `GET /api/admin/bank-statements/transactions` — Query parsed transactions with match status filters.
- `POST /api/admin/reconciliation/run` — Run batch reconciliation across pending entries.
- `POST /api/admin/reconciliation/entries/:entryId/run` — Re-evaluate reconciliation for a single entry.
- `GET /api/admin/reconciliation/entries/:entryId/candidates` — Find candidate credit transactions for an entry.

### Admin Reports
- `GET /api/admin/reports/export?format=xlsx` — Download register as structured Excel spreadsheet.
- `GET /api/admin/reports/export?format=pdf` — Download register as formatted PDF document.

### System Health
- `GET /api/health` — Health check endpoint reporting overall and database status.

---

## Security, Integrity & Fraud Prevention

1. **Client Never Dictates Payment State**: There is no endpoint in the system where a client can send `{"paid": true}`. The API strictly forbids unknown DTO properties.
2. **Global UTR Uniqueness**: The `PaymentClaim.utrNormalized` field enforces a database-level unique constraint across the entire system. One reference number can never be claimed by two different entries.
3. **Double-Spend Credit Lock**: `BankTransaction.matchedEntryId` is uniquely indexed. When reconciliation matches an entry to a credit, it uses an atomic conditional check (`WHERE matchedEntryId IS NULL`) to ensure concurrent threads cannot match the same bank credit twice.
4. **Statement Fingerprinting**: Every uploaded statement is SHA-256 hashed. Uploading an identical statement file returns `409 Conflict`. Overlapping rows across different statements are safely deduplicated using `rowHash`.
5. **No PII Leaks via Enumeration**: Guest access uses an unguessable 24-character cryptographic token (`accessToken`). Incremental database IDs are never exposed on public routes.
6. **Immutable Audit Trails**: Every administrator sign-in, cash attestation, manual match, transaction unlink, and report export is written to the `AuditLog` table with user ID, IP address, and timestamp.
7. **Rate Limiting**: Throttling guards on public routes prevent automated brute-forcing or denial of service during peak event times.
8. **Sensitive Credential Protection**: The app never asks for, records, or processes UPI PINs, bank passwords, OTPs, or debit card numbers.

---

## Verification & Testing Checklist

The system has been comprehensively validated against the test plan documented in [`docs/testing.md`](docs/testing.md).

### Try the End-to-End Flow Locally in 3 Minutes:
1. Open the guest portal: <http://localhost:5173/e/kumar-wedding-2026>.
2. Submit a contribution:
   - **Name**: `Rajesh Kannan`
   - **Amount**: `₹1,000`
   - Proceed to the UPI step.
3. On the reference screen, enter the UTR: `555444333222`.
4. The status shows `AWAITING_VERIFICATION`.
5. Open the Admin Dashboard: <http://localhost:5174> and sign in with `admin@moiledger.local` / `ChangeMe#123`.
6. Go to **Reconciliation**, select the event, and upload `apps/api/prisma/sample-bank-statement.csv`.
7. Notice how the matching entry with reference `555444333222` automatically turns **`VERIFIED`**!
8. Navigate to **Reports** and click **Export Excel** and **Export PDF** to view the finalized registers.

---

## License

This project is proprietary and intended for digital Moi and event ledger management. All rights reserved.
