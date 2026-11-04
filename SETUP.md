# Project Setup & Run Guide

> **Purpose**: This file provides a fresh, concise guide for setting up and running the entire **MoiLedger** project without modifying the original `README.md`.

---

## Prerequisites

- **Node.js** v20.x or newer
- **pnpm** v9.x or newer (`npm install -g pnpm`)
- **Docker & Docker Compose** (or an existing PostgreSQL 14+ instance)

---

## Step‑by‑Step Setup

1. **Install workspace dependencies**
   ```bash
   pnpm install
   ```

2. **Start the PostgreSQL database** (Docker Compose)
   ```bash
   pnpm db:up
   ```
   Verify with `docker ps` – you should see a container named `moi-postgres` listening on port `5433`.

3. **Create environment files**
   ```bash
   # API
   cp apps/api/.env.example apps/api/.env
   # Guest web
   cp apps/guest-web/.env.example apps/guest-web/.env
   # Admin web
   cp apps/admin-web/.env.example apps/admin-web/.env
   ```
   *On Windows PowerShell use `copy` instead of `cp`.*

4. **Run Prisma migrations & seed demo data**
   ```bash
   # Apply migrations
   pnpm db:migrate
   # Seed admin user, sample event, and demo entries
   pnpm db:seed
   ```

5. **Start all services together**
   ```bash
   pnpm dev
   ```
   This launches:
   - NestJS API on **http://localhost:4000**
   - Guest web app on **http://localhost:5173**
   - Admin dashboard on **http://localhost:5174**

---

## Running Services Individually (optional)

| Service | Command | Port |
|---|---|---|
| API backend | `pnpm dev:api` | 4000 |
| Guest web | `pnpm dev:guest` | 5173 |
| Admin web | `pnpm dev:admin` | 5174 |

---

## URLs

- **API health**: `http://localhost:4000/api/health`
- **Guest portal (example event)**: `http://localhost:5173/e/kumar-wedding-2026`
- **Admin dashboard**: `http://localhost:5174`

---

## Database Management Shortcuts

| Shortcut | Action |
|---|---|
| `pnpm db:up` | Start PostgreSQL container |
| `pnpm db:down` | Stop PostgreSQL container |
| `pnpm db:migrate` | Apply Prisma migrations |
| `pnpm db:seed` | Populate seed data |
| `pnpm --filter @moi/api prisma:studio` | Open Prisma Studio (http://localhost:5555) |

---

## Quick Verification

1. Open the guest portal URL above and submit a test entry.
2. Upload the sample statement `apps/api/prisma/sample-bank-statement.csv` via the Admin dashboard.
3. Verify the entry status changes to **VERIFIED**.

---

*All commands are run from the repository root (`c:\Users\user\OneDrive\Documents\projects\moi`).*

