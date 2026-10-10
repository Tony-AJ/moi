# Deployment

Written for: whoever ships this to production.

## Topology

| Piece | Host | Notes |
| --- | --- | --- |
| Guest web | Vercel (public) | `vercel.json` already rewrites all routes to `index.html` |
| Admin web | Vercel, separate project or subdomain | Ships `noindex`, `DENY` framing, `no-referrer` headers |
| API | Any Node 20 host (Railway, Render, Fly, VPS) | Needs persistent outbound HTTPS only |
| Database | Managed Postgres 14+ | Enable automated backups |

Keep the admin app on its own deployment/subdomain so a guest-side mistake can
never expose the dashboard.

## 1. Database

```bash
# from a machine with the production DATABASE_URL
pnpm --filter @moi/api prisma:deploy     # prisma migrate deploy
```

Do **not** run `prisma migrate dev` or the seed script against production.
Create the first admin instead:

```bash
DATABASE_URL=... SEED_ADMIN_EMAIL=you@example.com \
SEED_ADMIN_PASSWORD='<strong-unique>' pnpm --filter @moi/api seed
```

The seed only upserts the admin and a demo event; delete the demo event from
the dashboard afterwards, then change the password from the UI.

## 2. API environment

```env
DATABASE_URL=postgresql://user:pass@host:5432/moi?sslmode=require
NODE_ENV=production
PORT=4000
JWT_SECRET=<48+ random chars>
JWT_EXPIRES_IN=8h
CORS_ORIGINS=https://moi.example.com,https://admin-moi.example.com
GUEST_WEB_URL=https://moi.example.com
DEFAULT_UPI_ID=yourname@okicici
DEFAULT_UPI_PAYEE_NAME=Your Name
```

The API refuses to boot without `DATABASE_URL` and a `JWT_SECRET` of at least
32 characters — that check is deliberate, do not weaken it.

Build and run:

```bash
pnpm install --frozen-lockfile
pnpm --filter @moi/api prisma:generate
pnpm --filter @moi/api build
node apps/api/dist/main.js
```

## 3. Frontend environment

```env
# guest-web
VITE_API_BASE_URL=https://api-moi.example.com/api

# admin-web
VITE_API_BASE_URL=https://api-moi.example.com/api
```

Vite inlines these at build time, so a change needs a rebuild.

## 4. Pre-flight checklist

- [ ] HTTPS on all three hosts; no mixed content.
- [ ] `CORS_ORIGINS` lists exactly the two deployed origins — no `*`.
- [ ] `JWT_SECRET` is unique to production and stored only in the host's secret
      manager.
- [ ] Seeded demo event deleted; seeded admin password changed.
- [ ] `GUEST_WEB_URL` is the public URL, verified by opening the QR link from a
      phone on mobile data (not the office WiFi).
- [ ] QR codes printed **after** confirming the above. The admin UI warns on a
      localhost URL; heed it.
- [ ] Database backups enabled and a restore tested once.
- [ ] Error logging/alerting wired to the API's stdout.
- [ ] Rate limits reviewed for the expected crowd (default: 10 entry
      creations/min/IP — raise it if the venue shares one NAT, since every guest
      appears as the same IP).
- [ ] A staff member knows how to run **Reconciliation → Import** on the day.

## 5. On the day

1. Open the event in the dashboard, confirm it shows **Open**.
2. Keep one phone on the guest page as a canary.
3. Import the statement at intervals (banks lag; UPI credits usually appear
   within minutes but can take hours).
4. Work the review queue rather than bulk-verifying: every verification is
   attributed to the admin who made it.
5. After the event, close the event to stop new entries, run a final import,
   then export both reports and store them with the family records.

## 6. Scaling notes

- The API is stateless; run multiple instances behind a load balancer if
  needed. Matching is safe under concurrency (unique constraint + conditional
  update), but statement imports should be kept to one at a time.
- Rate limiting is in-memory per instance. With more than one instance, move
  `ThrottlerModule` to the Redis storage adapter.
- Reports are generated in-process and streamed as attachments; for very large
  registers (>20k rows) generate them in a worker instead.
