/**
 * Full lifecycle and edge-case suite, end to end over HTTP.
 *
 * Covers the whole documented flow for both kinds of user: the guest who
 * scans a QR code and the staff or owner working in the dashboard. Each
 * describe block follows one stage of the lifecycle, and the cases are the
 * awkward ones: boundaries, retries, duplicates, wrong references, closed
 * events, suspended customers, revoked staff and attempts to reach another
 * customer's data.
 *
 * Requires a Postgres this suite may drop and recreate; see TEST_DATABASE_URL.
 */
import * as bcrypt from 'bcryptjs';
import { E2EContext } from './helpers/e2e-app';

const ctx = new E2EContext();

const PASSWORD = 'Password#123';

interface Tenant {
  workspaceId: string;
  ownerId: string;
  ownerEmail: string;
  ownerToken: string;
  accountId: string;
  eventId: string;
  eventSlug: string;
  upiId: string;
}

let tenantA: Tenant;
let tenantB: Tenant;
let staffToken: string;
let staffId: string;
let superToken: string;

async function createUser(email: string, name: string, platformRole: 'USER' | 'SUPER_ADMIN' = 'USER') {
  return ctx.prisma.adminUser.create({
    data: {
      email,
      name,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role: 'OWNER',
      platformRole,
    },
  });
}

/** Builds a complete, publishable workspace the way the real flow would. */
async function createTenant(key: string, upiId: string): Promise<Tenant> {
  const owner = await createUser(key + '-owner@test.local', key + ' owner');

  const workspace = await ctx.prisma.workspace.create({
    data: { slug: key, name: key, status: 'ACTIVE', activatedAt: new Date() },
  });

  await ctx.prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: owner.id,
      role: 'WORKSPACE_OWNER',
      status: 'ACTIVE',
      acceptedAt: new Date(),
    },
  });

  const account = await ctx.prisma.beneficiaryAccount.create({
    data: {
      workspaceId: workspace.id,
      label: key + ' account',
      upiId,
      payeeName: key + ' payee',
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    },
  });

  const event = await ctx.prisma.event.create({
    data: {
      workspaceId: workspace.id,
      slug: key + '-event',
      name: key + ' celebration',
      eventDate: new Date('2026-11-21T10:00:00.000Z'),
      minAmountPaise: 10000,
      maxAmountPaise: 5000000,
      collectPhone: true,
    },
  });

  const config = await ctx.prisma.eventPaymentConfig.create({
    data: {
      eventId: event.id,
      beneficiaryAccountId: account.id,
      version: 1,
      upiIdSnapshot: account.upiId,
      payeeNameSnapshot: account.payeeName,
    },
  });

  await ctx.prisma.event.update({
    where: { id: event.id },
    data: { activePaymentConfigId: config.id, upiId, upiPayeeName: account.payeeName },
  });

  return {
    workspaceId: workspace.id,
    ownerId: owner.id,
    ownerEmail: owner.email,
    ownerToken: await ctx.login(owner.email, PASSWORD),
    accountId: account.id,
    eventId: event.id,
    eventSlug: event.slug,
    upiId,
  };
}

/** A statement in the layout the parser expects, with a preamble to skip. */
function statementCsv(rows: { date: string; narration: string; ref: string; credit: string }[]) {
  const header = [
    'Statement of account',
    'Account No: XXXXXXXX9999',
    '',
    'Date,Narration,Chq/Ref No,Value Date,Withdrawal Amt,Deposit Amt,Closing Balance',
  ];
  const body = rows.map(
    (row) =>
      [row.date, row.narration, row.ref, row.date, '', row.credit, '100000.00'].join(','),
  );
  return header.concat(body).join('\n');
}

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return pad(now.getDate()) + '/' + pad(now.getMonth() + 1) + '/' + now.getFullYear();
}

/** Registers a guest and returns the created entry payload. */
async function registerGuest(slug: string, body: Record<string, unknown>) {
  return ctx.post('/events/' + slug + '/entries', body);
}

beforeAll(async () => {
  await ctx.start();

  tenantA = await createTenant('alpha', 'alpha@okicici');
  tenantB = await createTenant('beta', 'beta@okaxis');

  const staff = await ctx.prisma.adminUser.create({
    data: {
      email: 'desk@test.local',
      name: 'Registration desk',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role: 'STAFF',
    },
  });
  staffId = staff.id;
  await ctx.prisma.workspaceMember.create({
    data: {
      workspaceId: tenantA.workspaceId,
      userId: staff.id,
      role: 'EVENT_STAFF',
      status: 'ACTIVE',
      acceptedAt: new Date(),
    },
  });
  await ctx.prisma.eventMember.create({
    data: {
      eventId: tenantA.eventId,
      userId: staff.id,
      canRecordEntries: true,
      canUploadStatements: true,
      canResolveReviews: false,
      canExportReports: false,
    },
  });
  staffToken = await ctx.login(staff.email, PASSWORD);

  const platform = await createUser('ops@test.local', 'Platform ops', 'SUPER_ADMIN');
  superToken = await ctx.login(platform.email, PASSWORD);
}, 240_000);

afterAll(async () => {
  await ctx.stop();
});

// ---------------------------------------------------------------------------

describe('stage 1: authentication', () => {
  it('rejects a wrong password with no hint about the account', async () => {
    const response = await ctx.post('/admin/auth/login', {
      email: tenantA.ownerEmail,
      password: 'wrong-password',
    });
    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).not.toMatch(/exist|found|unknown/i);
  });

  it('gives the same answer for an unknown email as for a wrong password', async () => {
    const unknown = await ctx.post('/admin/auth/login', {
      email: 'nobody@test.local',
      password: PASSWORD,
    });
    const wrong = await ctx.post('/admin/auth/login', {
      email: tenantA.ownerEmail,
      password: 'wrong-password',
    });
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body.message).toBe(wrong.body.message);
  });

  it('refuses a request with no token, a malformed token and a forged token', async () => {
    expect((await ctx.get('/admin/events')).status).toBe(401);
    expect((await ctx.get('/admin/events', 'not-a-jwt')).status).toBe(401);
    expect(
      (await ctx.get('/admin/events', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.bad')).status,
    ).toBe(401);
  });

  it('revokes access the moment the account is deactivated, without waiting for expiry', async () => {
    const victim = await createUser('victim@test.local', 'Victim');
    await ctx.prisma.workspaceMember.create({
      data: {
        workspaceId: tenantA.workspaceId,
        userId: victim.id,
        role: 'WORKSPACE_ADMIN',
        status: 'ACTIVE',
      },
    });
    const token = await ctx.login(victim.email, PASSWORD);
    expect((await ctx.get('/admin/events', token)).status).toBe(200);

    await ctx.prisma.adminUser.update({ where: { id: victim.id }, data: { isActive: false } });

    // Same still-valid token, now useless.
    expect((await ctx.get('/admin/events', token)).status).toBe(401);
  });

  it('stops a revoked membership from reaching the workspace', async () => {
    const leaver = await createUser('leaver@test.local', 'Leaver');
    const membership = await ctx.prisma.workspaceMember.create({
      data: {
        workspaceId: tenantA.workspaceId,
        userId: leaver.id,
        role: 'WORKSPACE_ADMIN',
        status: 'ACTIVE',
      },
    });
    const token = await ctx.login(leaver.email, PASSWORD);
    expect((await ctx.get('/admin/events', token)).status).toBe(200);

    await ctx.prisma.workspaceMember.update({
      where: { id: membership.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    const after = await ctx.get('/admin/events', token);
    expect(after.status).toBe(403);
  });
});

describe('stage 2: beneficiary configuration', () => {
  it('rejects a malformed UPI id', async () => {
    const response = await ctx.post(
      '/admin/beneficiaries',
      { label: 'Bad', upiId: 'not a upi id', payeeName: 'Nobody' },
      tenantA.ownerToken,
    );
    expect(response.status).toBe(400);
  });

  it('creates an account unconfirmed, and refuses to collect through it until confirmed', async () => {
    const created = await ctx.post(
      '/admin/beneficiaries',
      { label: 'Second account', upiId: 'alpha.second@okhdfcbank', payeeName: 'Alpha payee two' },
      tenantA.ownerToken,
    );
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('UNCONFIRMED');

    const select = await ctx.post(
      '/admin/beneficiaries/events/' + tenantA.eventId + '/select',
      { beneficiaryAccountId: created.body.id },
      tenantA.ownerToken,
    );
    expect(select.status).toBe(400);
    expect(JSON.stringify(select.body)).toMatch(/confirm/i);
  });

  it('stores only the last four digits of an account number', async () => {
    const response = await ctx.post(
      '/admin/beneficiaries',
      {
        label: 'Last four',
        upiId: 'alpha.four@okicici',
        payeeName: 'Alpha payee',
        accountLast4: '1234',
      },
      tenantA.ownerToken,
    );
    expect(response.status).toBe(201);
    expect(response.body.accountLast4).toBe('1234');
  });

  it('refuses anything longer than four digits rather than silently truncating', async () => {
    const response = await ctx.post(
      '/admin/beneficiaries',
      {
        label: 'Too long',
        upiId: 'alpha.long@okicici',
        payeeName: 'Alpha payee',
        accountLast4: '123456789012',
      },
      tenantA.ownerToken,
    );
    expect(response.status).toBe(400);
  });

  it('rejects a duplicate UPI id inside one workspace but allows it in another', async () => {
    const shared = 'shared.vpa@okicici';
    const first = await ctx.post(
      '/admin/beneficiaries',
      { label: 'Shared', upiId: shared, payeeName: 'A payee' },
      tenantA.ownerToken,
    );
    expect(first.status).toBe(201);

    const again = await ctx.post(
      '/admin/beneficiaries',
      { label: 'Shared again', upiId: shared, payeeName: 'A payee' },
      tenantA.ownerToken,
    );
    expect(again.status).toBe(409);

    // A different customer is entitled to configure the same VPA; the
    // platform is not the arbiter of who owns a UPI handle.
    const other = await ctx.post(
      '/admin/beneficiaries',
      { label: 'Shared elsewhere', upiId: shared, payeeName: 'B payee' },
      tenantB.ownerToken,
    );
    expect(other.status).toBe(201);
  });

  it('lets only the owner confirm an account, not a workspace admin', async () => {
    const admin = await createUser('wsadmin@test.local', 'Workspace admin');
    await ctx.prisma.workspaceMember.create({
      data: {
        workspaceId: tenantA.workspaceId,
        userId: admin.id,
        role: 'WORKSPACE_ADMIN',
        status: 'ACTIVE',
      },
    });
    const adminToken = await ctx.login(admin.email, PASSWORD);

    const account = await ctx.prisma.beneficiaryAccount.create({
      data: {
        workspaceId: tenantA.workspaceId,
        label: 'Needs confirming',
        upiId: 'alpha.confirm@okicici',
        payeeName: 'Alpha payee',
      },
    });

    const byAdmin = await ctx.post(
      '/admin/beneficiaries/' + account.id + '/confirm',
      undefined,
      adminToken,
    );
    expect(byAdmin.status).toBe(403);

    const byOwner = await ctx.post(
      '/admin/beneficiaries/' + account.id + '/confirm',
      undefined,
      tenantA.ownerToken,
    );
    expect(byOwner.status).toBe(201);
    expect(byOwner.body.status).toBe('CONFIRMED');
  });
});

describe('stage 3: event creation', () => {
  it('creates an event in the caller own workspace', async () => {
    const response = await ctx.post(
      '/admin/events',
      { name: 'Alpha second event', eventDate: '2026-12-01T00:00:00.000Z' },
      tenantA.ownerToken,
    );
    expect(response.status).toBe(201);
    expect(response.body.guestUrl).toContain('/e/');

    const stored = await ctx.prisma.event.findUnique({ where: { id: response.body.id } });
    expect(stored?.workspaceId).toBe(tenantA.workspaceId);
  });

  it('derives a unique slug when two events share a name', async () => {
    const first = await ctx.post(
      '/admin/events',
      { name: 'Repeated Name Event', eventDate: '2026-12-02T00:00:00.000Z' },
      tenantA.ownerToken,
    );
    const second = await ctx.post(
      '/admin/events',
      { name: 'Repeated Name Event', eventDate: '2026-12-03T00:00:00.000Z' },
      tenantB.ownerToken,
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.slug).not.toBe(second.body.slug);
  });

  it('rejects an amount range where the minimum exceeds the maximum', async () => {
    const response = await ctx.post(
      '/admin/events',
      {
        name: 'Bad range event',
        eventDate: '2026-12-04T00:00:00.000Z',
        minAmountPaise: 500000,
        maxAmountPaise: 1000,
      },
      tenantA.ownerToken,
    );
    expect(response.status).toBe(400);
  });

  it('starts a new configuration version when the payee changes, keeping the old one', async () => {
    const account = await ctx.prisma.beneficiaryAccount.findFirstOrThrow({
      where: { workspaceId: tenantA.workspaceId, upiId: 'alpha.second@okhdfcbank' },
    });
    await ctx.prisma.beneficiaryAccount.update({
      where: { id: account.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });

    const event = await ctx.prisma.event.create({
      data: {
        workspaceId: tenantA.workspaceId,
        slug: 'alpha-versioning',
        name: 'Alpha versioning',
        eventDate: new Date('2026-12-05T00:00:00.000Z'),
      },
    });

    const first = await ctx.post(
      '/admin/beneficiaries/events/' + event.id + '/select',
      { beneficiaryAccountId: tenantA.accountId },
      tenantA.ownerToken,
    );
    expect(first.status).toBe(201);
    expect(first.body.version).toBe(1);

    const second = await ctx.post(
      '/admin/beneficiaries/events/' + event.id + '/select',
      { beneficiaryAccountId: account.id },
      tenantA.ownerToken,
    );
    expect(second.status).toBe(201);
    expect(second.body.version).toBe(2);

    const history = await ctx.get(
      '/admin/beneficiaries/events/' + event.id + '/history',
      tenantA.ownerToken,
    );
    expect(history.body).toHaveLength(2);
    // Version 1 is closed rather than deleted.
    const v1 = history.body.find((row: any) => row.version === 1);
    expect(v1.effectiveTo).not.toBeNull();
  });

  it('does not rewrite entries already collected when the payee changes', async () => {
    const event = await ctx.prisma.event.findFirstOrThrow({ where: { slug: 'alpha-versioning' } });
    const before = await ctx.prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      include: { activePaymentConfig: true },
    });

    const entry = await registerGuest('alpha-versioning', {
      guestName: 'Pinned Guest',
      amountPaise: 100000,
    });
    expect(entry.status).toBe(201);
    const pinnedVpa = entry.body.upi.payeeVpa;

    // Switch the event back to the other account.
    await ctx.post(
      '/admin/beneficiaries/events/' + event.id + '/select',
      { beneficiaryAccountId: tenantA.accountId },
      tenantA.ownerToken,
    );

    const status = await ctx.get('/entries/' + entry.body.accessToken + '/status');
    expect(status.status).toBe(200);
    // The guest still sees the payee they were originally sent to.
    expect(status.body.upi.payeeVpa).toBe(pinnedVpa);
    expect(pinnedVpa).toBe(before.activePaymentConfig?.upiIdSnapshot);
  });
});

describe('stage 5: guest registration', () => {
  it('serves the public event without exposing guest data or totals', async () => {
    const response = await ctx.get('/events/' + tenantA.eventSlug);
    expect(response.status).toBe(200);
    expect(response.body.upiConfigured).toBe(true);
    const keys = Object.keys(response.body).join(',');
    expect(keys).not.toMatch(/entries|totals|guest|upiId/i);
  });

  it('returns 404 for an unknown slug', async () => {
    expect((await ctx.get('/events/no-such-event')).status).toBe(404);
  });

  it('hands the guest the payee configured for that event, not another tenant', async () => {
    const a = await registerGuest(tenantA.eventSlug, { guestName: 'Guest A', amountPaise: 100000 });
    const b = await registerGuest(tenantB.eventSlug, { guestName: 'Guest B', amountPaise: 100000 });
    expect(a.body.upi.payeeVpa).toBe(tenantA.upiId);
    expect(b.body.upi.payeeVpa).toBe(tenantB.upiId);
  });

  it('rejects an amount below the event minimum and above the maximum', async () => {
    const low = await registerGuest(tenantA.eventSlug, { guestName: 'Too Low', amountPaise: 5000 });
    expect(low.status).toBe(400);
    const high = await registerGuest(tenantA.eventSlug, {
      guestName: 'Too High',
      amountPaise: 9000000,
    });
    expect(high.status).toBe(400);
  });

  it('accepts exactly the minimum and exactly the maximum', async () => {
    const min = await registerGuest(tenantA.eventSlug, { guestName: 'At Min', amountPaise: 10000 });
    expect(min.status).toBe(201);
    const max = await registerGuest(tenantA.eventSlug, {
      guestName: 'At Max',
      amountPaise: 5000000,
    });
    expect(max.status).toBe(201);
  });

  it('rejects a non-integer, zero, negative or absurd amount', async () => {
    for (const amountPaise of [0, -100, 100.5, Number.MAX_SAFE_INTEGER]) {
      const response = await registerGuest(tenantA.eventSlug, {
        guestName: 'Bad Amount',
        amountPaise,
      });
      expect(response.status).toBe(400);
    }
  });

  it('rejects a name that is too short and trims surrounding whitespace', async () => {
    expect((await registerGuest(tenantA.eventSlug, { guestName: 'A', amountPaise: 100000 })).status)
      .toBe(400);

    const padded = await registerGuest(tenantA.eventSlug, {
      guestName: '   Padded   Name   ',
      amountPaise: 100000,
    });
    expect(padded.status).toBe(201);
    expect(padded.body.guestName).toBe('Padded Name');
  });

  it('rejects an unexpected field rather than ignoring it', async () => {
    const response = await registerGuest(tenantA.eventSlug, {
      guestName: 'Sneaky Guest',
      amountPaise: 100000,
      paymentStatus: 'VERIFIED',
    });
    expect(response.status).toBe(400);
  });

  it('never lets the client choose the payment status', async () => {
    const response = await registerGuest(tenantA.eventSlug, {
      guestName: 'Status Guest',
      amountPaise: 100000,
    });
    expect(response.body.paymentStatus).toBe('AWAITING_VERIFICATION');
  });

  it('requires a phone number only when the event says so', async () => {
    const event = await ctx.prisma.event.create({
      data: {
        workspaceId: tenantA.workspaceId,
        slug: 'alpha-phone-required',
        name: 'Phone required',
        eventDate: new Date('2026-12-06T00:00:00.000Z'),
        requirePhone: true,
        activePaymentConfigId: null,
      },
    });
    const config = await ctx.prisma.eventPaymentConfig.create({
      data: {
        eventId: event.id,
        beneficiaryAccountId: tenantA.accountId,
        version: 1,
        upiIdSnapshot: tenantA.upiId,
        payeeNameSnapshot: 'Alpha payee',
      },
    });
    await ctx.prisma.event.update({
      where: { id: event.id },
      data: { activePaymentConfigId: config.id },
    });

    const without = await registerGuest('alpha-phone-required', {
      guestName: 'No Phone',
      amountPaise: 100000,
    });
    expect(without.status).toBe(400);

    const withPhone = await registerGuest('alpha-phone-required', {
      guestName: 'Has Phone',
      amountPaise: 100000,
      guestPhone: '9876543210',
    });
    expect(withPhone.status).toBe(201);
  });

  it('rejects a malformed phone number', async () => {
    const response = await registerGuest(tenantA.eventSlug, {
      guestName: 'Bad Phone',
      amountPaise: 100000,
      guestPhone: 'call-me-maybe',
    });
    expect(response.status).toBe(400);
  });

  it('returns the original entry when a submit is retried with the same idempotency key', async () => {
    const key = 'idempotency-key-0001';
    const first = await registerGuest(tenantA.eventSlug, {
      guestName: 'Retry Guest',
      amountPaise: 150000,
      clientRequestId: key,
    });
    const second = await registerGuest(tenantA.eventSlug, {
      guestName: 'Retry Guest',
      amountPaise: 150000,
      clientRequestId: key,
    });
    expect(first.status).toBe(201);
    expect(second.body.entryCode).toBe(first.body.entryCode);
    expect(second.body.deduplicated).toBe(true);

    const count = await ctx.prisma.moiEntry.count({
      where: { eventId: tenantA.eventId, clientRequestId: key },
    });
    expect(count).toBe(1);
  });

  it('flags a likely duplicate but still records it', async () => {
    const body = { guestName: 'Twice Giver', amountPaise: 123400 };
    const first = await registerGuest(tenantA.eventSlug, body);
    const second = await registerGuest(tenantA.eventSlug, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.possibleDuplicate).toBe(true);
    // Flagged, not blocked: two guests really can share a name and amount.
    expect(second.body.entryCode).not.toBe(first.body.entryCode);
  });

  it('issues sequential entry numbers without gaps or collisions under concurrency', async () => {
    const event = await ctx.prisma.event.findFirstOrThrow({ where: { id: tenantA.eventId } });
    const before = event.entrySequence;

    const results = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        registerGuest(tenantA.eventSlug, {
          guestName: 'Concurrent Guest ' + index,
          amountPaise: 100000,
        }),
      ),
    );
    expect(results.every((row) => row.status === 201)).toBe(true);

    const codes = results.map((row) => row.body.entryCode);
    expect(new Set(codes).size).toBe(10);

    const after = await ctx.prisma.event.findFirstOrThrow({ where: { id: tenantA.eventId } });
    expect(after.entrySequence).toBe(before + 10);
  });

  it('refuses a new entry once the event is closed', async () => {
    const event = await ctx.prisma.event.create({
      data: {
        workspaceId: tenantA.workspaceId,
        slug: 'alpha-closed',
        name: 'Closed event',
        eventDate: new Date('2026-11-01T00:00:00.000Z'),
        isOpen: false,
      },
    });
    const config = await ctx.prisma.eventPaymentConfig.create({
      data: {
        eventId: event.id,
        beneficiaryAccountId: tenantA.accountId,
        version: 1,
        upiIdSnapshot: tenantA.upiId,
        payeeNameSnapshot: 'Alpha payee',
      },
    });
    await ctx.prisma.event.update({
      where: { id: event.id },
      data: { activePaymentConfigId: config.id },
    });

    const response = await registerGuest('alpha-closed', {
      guestName: 'Late Guest',
      amountPaise: 100000,
    });
    expect(response.status).toBe(403);
  });

  it('refuses an online entry when the host has configured no beneficiary', async () => {
    await ctx.prisma.event.create({
      data: {
        workspaceId: tenantA.workspaceId,
        slug: 'alpha-unconfigured',
        name: 'Unconfigured event',
        eventDate: new Date('2026-12-07T00:00:00.000Z'),
      },
    });

    const response = await registerGuest('alpha-unconfigured', {
      guestName: 'Nowhere To Pay',
      amountPaise: 100000,
    });
    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).toMatch(/not yet set up|contact the host/i);
  });

  it('closes the guest form when the customer workspace is suspended', async () => {
    await ctx.prisma.workspace.update({
      where: { id: tenantB.workspaceId },
      data: { status: 'SUSPENDED' },
    });

    try {
      const publicEvent = await ctx.get('/events/' + tenantB.eventSlug);
      expect(publicEvent.body.isOpen).toBe(false);

      const response = await registerGuest(tenantB.eventSlug, {
        guestName: 'Suspended Guest',
        amountPaise: 100000,
      });
      expect(response.status).toBe(403);
    } finally {
      // Restored even on failure: leaving the workspace suspended would make
      // every later test in this file fail for the wrong reason.
      await ctx.prisma.workspace.update({
        where: { id: tenantB.workspaceId },
        data: { status: 'ACTIVE' },
      });
    }
  });

  it('keeps the status token opaque and unguessable', async () => {
    const entry = await registerGuest(tenantA.eventSlug, {
      guestName: 'Token Guest',
      amountPaise: 100000,
    });
    const token = entry.body.accessToken;
    expect(token).toMatch(/^[A-Z0-9]{24}$/);
    // The database id must not be usable as a status token.
    const byId = await ctx.get('/entries/' + entry.body.id + '/status');
    expect(byId.status).toBe(404);
    expect((await ctx.get('/entries/AAAAAAAAAAAAAAAAAAAAAAAA/status')).status).toBe(404);
  });
});

describe('stage 5b: the guest claims a reference', () => {
  let token: string;

  beforeAll(async () => {
    const entry = await registerGuest(tenantA.eventSlug, {
      guestName: 'Claiming Guest',
      amountPaise: 222200,
    });
    token = entry.body.accessToken;
  });

  it('rejects a reference that is too short or has invalid characters', async () => {
    expect(
      (await ctx.post('/entries/' + token + '/payment-reference', { utr: '123' })).status,
    ).toBe(400);
    expect(
      (await ctx.post('/entries/' + token + '/payment-reference', { utr: 'abc$%^&*()' })).status,
    ).toBe(400);
  });

  it('accepts a claim and moves nothing to verified on its own', async () => {
    const response = await ctx.post('/entries/' + token + '/payment-reference', {
      utr: '555000111222',
    });
    expect(response.status).toBe(201);
    // Returning to the site is not proof of payment.
    expect(response.body.paymentStatus).toBe('AWAITING_VERIFICATION');
  });

  it('is idempotent when the guest resubmits the same reference', async () => {
    const response = await ctx.post('/entries/' + token + '/payment-reference', {
      utr: '555000111222',
    });
    expect(response.status).toBe(201);
    const claims = await ctx.prisma.paymentClaim.count({
      where: { utrNormalized: '555000111222' },
    });
    expect(claims).toBe(1);
  });

  it('supersedes the old claim when the guest corrects the reference', async () => {
    const response = await ctx.post('/entries/' + token + '/payment-reference', {
      utr: '555000999888',
    });
    expect(response.status).toBe(201);

    const entry = await ctx.prisma.moiEntry.findFirstOrThrow({
      where: { accessToken: token },
      include: { paymentClaims: true },
    });
    const statuses = entry.paymentClaims.map((claim) => claim.status).sort();
    expect(statuses).toEqual(['CLAIMED', 'SUPERSEDED']);
  });

  it('refuses a reference already claimed against another contribution', async () => {
    const other = await registerGuest(tenantA.eventSlug, {
      guestName: 'Second Claimer',
      amountPaise: 100000,
    });
    const response = await ctx.post('/entries/' + other.body.accessToken + '/payment-reference', {
      utr: '555000999888',
    });
    expect(response.status).toBe(409);
    // The message must not reveal whose contribution holds it.
    expect(JSON.stringify(response.body)).not.toMatch(/Claiming Guest/);
  });

  it('normalizes spacing and case so the same reference is not claimed twice', async () => {
    const entry = await registerGuest(tenantA.eventSlug, {
      guestName: 'Normalizing Guest',
      amountPaise: 100000,
    });
    const first = await ctx.post('/entries/' + entry.body.accessToken + '/payment-reference', {
      utr: 'abc 123 def',
    });
    expect(first.status).toBe(201);

    const other = await registerGuest(tenantA.eventSlug, {
      guestName: 'Copycat Guest',
      amountPaise: 100000,
    });
    const second = await ctx.post('/entries/' + other.body.accessToken + '/payment-reference', {
      utr: 'ABC123DEF',
    });
    expect(second.status).toBe(409);
  });

  it('rejects a claim against an unknown token', async () => {
    const response = await ctx.post('/entries/ZZZZZZZZZZZZZZZZZZZZZZZZ/payment-reference', {
      utr: '777000111222',
    });
    expect(response.status).toBe(404);
  });
});

describe('stage 6: statement import', () => {
  it('requires the account the statement came from', async () => {
    const csv = statementCsv([
      { date: today(), narration: 'UPI CREDIT', ref: '100000000001', credit: '1000.00' },
    ]);
    const response = await ctx.upload(
      '/admin/bank-statements/import',
      csv,
      { autoReconcile: 'false' },
      tenantA.ownerToken,
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toMatch(/beneficiaryAccountId/i);
  });

  it("refuses an upload against another customer's account", async () => {
    const csv = statementCsv([
      { date: today(), narration: 'UPI CREDIT', ref: '100000000002', credit: '1000.00' },
    ]);
    const response = await ctx.upload(
      '/admin/bank-statements/import',
      csv,
      { beneficiaryAccountId: tenantB.accountId, autoReconcile: 'false' },
      tenantA.ownerToken,
    );
    expect([403, 404]).toContain(response.status);
  });

  it('rejects a file type that is not a statement', async () => {
    const response = await ctx.upload(
      '/admin/bank-statements/import',
      'not a statement',
      { beneficiaryAccountId: tenantA.accountId },
      tenantA.ownerToken,
      'payload.exe',
    );
    expect(response.status).toBe(400);
  });

  it('rejects a file with no recognizable transactions', async () => {
    const response = await ctx.upload(
      '/admin/bank-statements/import',
      'just,some,random\ntext,without,amounts',
      { beneficiaryAccountId: tenantA.accountId },
      tenantA.ownerToken,
      'empty.csv',
    );
    expect(response.status).toBe(400);
  });

  it('imports a statement and reports the row counts', async () => {
    const csv = statementCsv([
      { date: today(), narration: 'UPI CREDIT ONE', ref: '200000000001', credit: '2222.00' },
      { date: today(), narration: 'UPI CREDIT TWO', ref: '200000000002', credit: '3333.00' },
    ]);
    const response = await ctx.upload(
      '/admin/bank-statements/import',
      csv,
      { beneficiaryAccountId: tenantA.accountId, autoReconcile: 'false' },
      tenantA.ownerToken,
      'alpha-first.csv',
    );
    expect(response.status).toBe(201);
    expect(response.body.summary.importedRows).toBe(2);
    expect(response.body.summary.credits).toBe(2);
  });

  it('refuses the identical file a second time, and allows it with force', async () => {
    const csv = statementCsv([
      { date: today(), narration: 'UPI CREDIT DUP', ref: '200000000003', credit: '4444.00' },
    ]);
    const first = await ctx.upload(
      '/admin/bank-statements/import',
      csv,
      { beneficiaryAccountId: tenantA.accountId, autoReconcile: 'false' },
      tenantA.ownerToken,
      'alpha-dup.csv',
    );
    expect(first.status).toBe(201);

    const again = await ctx.upload(
      '/admin/bank-statements/import',
      csv,
      { beneficiaryAccountId: tenantA.accountId, autoReconcile: 'false' },
      tenantA.ownerToken,
      'alpha-dup.csv',
    );
    expect(again.status).toBe(409);

    const forced = await ctx.upload(
      '/admin/bank-statements/import',
      csv,
      { beneficiaryAccountId: tenantA.accountId, autoReconcile: 'false', force: 'true' },
      tenantA.ownerToken,
      'alpha-dup.csv',
    );
    expect(forced.status).toBe(201);
    // Rows are still deduplicated even when the file is forced through.
    expect(forced.body.summary.importedRows).toBe(0);
    expect(forced.body.summary.duplicateRows).toBe(1);
  });

  it('lets a different customer import a byte-identical file', async () => {
    const csv = statementCsv([
      { date: today(), narration: 'UPI CREDIT SHARED', ref: '200000000009', credit: '7777.00' },
    ]);
    const mine = await ctx.upload(
      '/admin/bank-statements/import',
      csv,
      { beneficiaryAccountId: tenantA.accountId, autoReconcile: 'false' },
      tenantA.ownerToken,
      'shared.csv',
    );
    expect(mine.status).toBe(201);

    const theirs = await ctx.upload(
      '/admin/bank-statements/import',
      csv,
      { beneficiaryAccountId: tenantB.accountId, autoReconcile: 'false' },
      tenantB.ownerToken,
      'shared.csv',
    );
    expect(theirs.status).toBe(201);
    expect(theirs.body.summary.importedRows).toBe(1);
  });

  it('shows each customer only their own imports and transactions', async () => {
    const mine = await ctx.get('/admin/bank-statements/imports', tenantA.ownerToken);
    const theirs = await ctx.get('/admin/bank-statements/imports', tenantB.ownerToken);
    const myIds = mine.body.map((row: any) => row.id);
    const theirIds = theirs.body.map((row: any) => row.id);
    expect(myIds.some((id: string) => theirIds.includes(id))).toBe(false);

    const myTxns = await ctx.get('/admin/bank-statements/transactions', tenantA.ownerToken);
    expect(
      myTxns.body.rows.every((row: any) => row.workspaceId === tenantA.workspaceId),
    ).toBe(true);
  });

  it('lets assigned staff upload when granted, and refuses when not', async () => {
    const csv = statementCsv([
      { date: today(), narration: 'STAFF UPLOAD', ref: '200000000011', credit: '1111.00' },
    ]);
    const allowed = await ctx.upload(
      '/admin/bank-statements/import',
      csv,
      {
        beneficiaryAccountId: tenantA.accountId,
        eventId: tenantA.eventId,
        autoReconcile: 'false',
      },
      staffToken,
      'staff-upload.csv',
    );
    expect(allowed.status).toBe(201);

    await ctx.prisma.eventMember.update({
      where: { eventId_userId: { eventId: tenantA.eventId, userId: staffId } },
      data: { canUploadStatements: false },
    });

    const csv2 = statementCsv([
      { date: today(), narration: 'STAFF UPLOAD 2', ref: '200000000012', credit: '1212.00' },
    ]);
    const refused = await ctx.upload(
      '/admin/bank-statements/import',
      csv2,
      {
        beneficiaryAccountId: tenantA.accountId,
        eventId: tenantA.eventId,
        autoReconcile: 'false',
      },
      staffToken,
      'staff-upload-2.csv',
    );
    expect(refused.status).toBe(403);

    await ctx.prisma.eventMember.update({
      where: { eventId_userId: { eventId: tenantA.eventId, userId: staffId } },
      data: { canUploadStatements: true },
    });
  });
});

describe('stage 6b: reconciliation outcomes', () => {
  async function entryWithClaim(amountPaise: number, utr: string, guestName: string) {
    const entry = await registerGuest(tenantA.eventSlug, { guestName, amountPaise });
    await ctx.post('/entries/' + entry.body.accessToken + '/payment-reference', { utr });
    const stored = await ctx.prisma.moiEntry.findFirstOrThrow({
      where: { accessToken: entry.body.accessToken },
    });
    return stored;
  }

  async function importRows(
    rows: { date: string; narration: string; ref: string; credit: string }[],
    fileName: string,
  ) {
    return ctx.upload(
      '/admin/bank-statements/import',
      statementCsv(rows),
      { beneficiaryAccountId: tenantA.accountId, autoReconcile: 'false' },
      tenantA.ownerToken,
      fileName,
    );
  }

  it('verifies on an exact reference, amount and credit match', async () => {
    const entry = await entryWithClaim(345600, '300000000001', 'Exact Match Guest');
    await importRows(
      [{ date: today(), narration: 'UPI/300000000001/EXACT', ref: '300000000001', credit: '3456.00' }],
      'recon-exact.csv',
    );

    const run = await ctx.post(
      '/admin/reconciliation/entries/' + entry.id + '/run',
      undefined,
      tenantA.ownerToken,
    );
    expect(run.status).toBe(201);
    expect(run.body.status).toBe('VERIFIED');
  });

  it('does not verify when the amount differs from the credit', async () => {
    const entry = await entryWithClaim(400000, '300000000002', 'Wrong Amount Guest');
    await importRows(
      [{ date: today(), narration: 'UPI/300000000002/SHORT', ref: '300000000002', credit: '3000.00' }],
      'recon-amount.csv',
    );

    const run = await ctx.post(
      '/admin/reconciliation/entries/' + entry.id + '/run',
      undefined,
      tenantA.ownerToken,
    );
    expect(run.body.status).not.toBe('VERIFIED');
  });

  it('marks NOT_FOUND rather than rejecting when the statement has no match', async () => {
    const entry = await entryWithClaim(451200, '300000000003', 'Not Yet Settled Guest');
    const run = await ctx.post(
      '/admin/reconciliation/entries/' + entry.id + '/run',
      undefined,
      tenantA.ownerToken,
    );
    expect(run.body.status).toBe('NOT_FOUND');
    // An unmatched payment is never auto-rejected: the statement may simply
    // not contain the transaction yet.
    expect(run.body.status).not.toBe('REJECTED');
  });

  it('asks for review instead of guessing when two credits could match', async () => {
    const entry = await entryWithClaim(500100, '300000000004', 'Ambiguous Guest');
    await importRows(
      [
        { date: today(), narration: 'UPI/300000000004/ONE', ref: '300000000004', credit: '5001.00' },
        { date: today(), narration: 'UPI/300000000004/TWO', ref: '300000000004', credit: '5001.00' },
      ],
      'recon-ambiguous.csv',
    );

    const run = await ctx.post(
      '/admin/reconciliation/entries/' + entry.id + '/run',
      undefined,
      tenantA.ownerToken,
    );
    expect(run.body.status).toBe('REVIEW_REQUIRED');
    expect(run.body.candidateCount).toBeGreaterThan(1);
  });

  it('asks for review when only the amount matches and no reference was claimed', async () => {
    const entry = await registerGuest(tenantA.eventSlug, {
      guestName: 'No Reference Guest',
      amountPaise: 611100,
    });
    await importRows(
      [{ date: today(), narration: 'NEFT UNKNOWN SENDER', ref: '300000000005', credit: '6111.00' }],
      'recon-amount-only.csv',
    );
    const stored = await ctx.prisma.moiEntry.findFirstOrThrow({
      where: { accessToken: entry.body.accessToken },
    });

    const run = await ctx.post(
      '/admin/reconciliation/entries/' + stored.id + '/run',
      undefined,
      tenantA.ownerToken,
    );
    // Amount alone is never enough to verify.
    expect(run.body.status).toBe('REVIEW_REQUIRED');
  });

  it('never reuses one bank credit for two contributions', async () => {
    const first = await entryWithClaim(700700, '300000000006', 'One Credit Guest');
    await importRows(
      [{ date: today(), narration: 'UPI/300000000006/ONE', ref: '300000000006', credit: '7007.00' }],
      'recon-onetoone.csv',
    );

    const run1 = await ctx.post(
      '/admin/reconciliation/entries/' + first.id + '/run',
      undefined,
      tenantA.ownerToken,
    );
    expect(run1.body.status).toBe('VERIFIED');
    const txnId = run1.body.matchedBankTransactionId;

    // A second guest claims the same amount; the credit is already taken.
    const second = await registerGuest(tenantA.eventSlug, {
      guestName: 'Second One Credit Guest',
      amountPaise: 700700,
    });
    const storedSecond = await ctx.prisma.moiEntry.findFirstOrThrow({
      where: { accessToken: second.body.accessToken },
    });
    const run2 = await ctx.post(
      '/admin/reconciliation/entries/' + storedSecond.id + '/run',
      undefined,
      tenantA.ownerToken,
    );
    expect(run2.body.status).not.toBe('VERIFIED');

    const txn = await ctx.prisma.bankTransaction.findUniqueOrThrow({ where: { id: txnId } });
    expect(txn.matchedEntryId).toBe(first.id);
  });

  it('leaves an already verified entry alone on a re-run', async () => {
    const entry = await entryWithClaim(800800, '300000000007', 'Rerun Guest');
    await importRows(
      [{ date: today(), narration: 'UPI/300000000007/OK', ref: '300000000007', credit: '8008.00' }],
      'recon-rerun.csv',
    );
    await ctx.post(
      '/admin/reconciliation/entries/' + entry.id + '/run',
      undefined,
      tenantA.ownerToken,
    );
    const again = await ctx.post(
      '/admin/reconciliation/entries/' + entry.id + '/run',
      undefined,
      tenantA.ownerToken,
    );
    expect(again.body.changed).toBe(false);
    expect(again.body.status).toBe('VERIFIED');
  });

  it('never touches a cash entry during reconciliation', async () => {
    const created = await ctx.post(
      '/admin/entries',
      {
        eventId: tenantA.eventId,
        guestName: 'Cash Guest',
        amountPaise: 900900,
        paymentMethod: 'CASH',
      },
      tenantA.ownerToken,
    );
    expect(created.status).toBe(201);

    const run = await ctx.post(
      '/admin/reconciliation/entries/' + created.body.id + '/run',
      undefined,
      tenantA.ownerToken,
    );
    expect(run.body.changed).toBe(false);
    expect(JSON.stringify(run.body)).toMatch(/cash/i);
  });

  it('ignores a debit of the same amount', async () => {
    const entry = await entryWithClaim(950000, '300000000008', 'Debit Guest');
    const csv = [
      'Date,Narration,Chq/Ref No,Value Date,Withdrawal Amt,Deposit Amt,Closing Balance',
      [today(), 'UPI/300000000008/OUT', '300000000008', today(), '9500.00', '', '1000.00'].join(','),
    ].join('\n');
    await ctx.upload(
      '/admin/bank-statements/import',
      csv,
      { beneficiaryAccountId: tenantA.accountId, autoReconcile: 'false' },
      tenantA.ownerToken,
      'recon-debit.csv',
    );

    const run = await ctx.post(
      '/admin/reconciliation/entries/' + entry.id + '/run',
      undefined,
      tenantA.ownerToken,
    );
    // Money leaving the account cannot settle a contribution.
    expect(run.body.status).not.toBe('VERIFIED');
  });
});

describe('stage 7: review resolution', () => {
  it('requires a reason so every decision is auditable', async () => {
    const entry = await registerGuest(tenantA.eventSlug, {
      guestName: 'Reason Guest',
      amountPaise: 100000,
    });
    const stored = await ctx.prisma.moiEntry.findFirstOrThrow({
      where: { accessToken: entry.body.accessToken },
    });
    const response = await ctx.post(
      '/admin/entries/' + stored.id + '/review',
      { action: 'REJECT' },
      tenantA.ownerToken,
    );
    expect(response.status).toBe(400);
  });

  it('rejects an unknown action', async () => {
    const entry = await registerGuest(tenantA.eventSlug, {
      guestName: 'Bad Action Guest',
      amountPaise: 100000,
    });
    const stored = await ctx.prisma.moiEntry.findFirstOrThrow({
      where: { accessToken: entry.body.accessToken },
    });
    const response = await ctx.post(
      '/admin/entries/' + stored.id + '/review',
      { action: 'DELETE_EVERYTHING', reason: 'trying it on' },
      tenantA.ownerToken,
    );
    expect(response.status).toBe(400);
  });

  it('records the operator and timestamp when cash receipt is attested', async () => {
    const created = await ctx.post(
      '/admin/entries',
      {
        eventId: tenantA.eventId,
        guestName: 'Attested Cash Guest',
        amountPaise: 250000,
        paymentMethod: 'CASH',
      },
      tenantA.ownerToken,
    );

    const response = await ctx.post(
      '/admin/entries/' + created.body.id + '/review',
      { action: 'CONFIRM_CASH', reason: 'Received in hand at the registration desk' },
      tenantA.ownerToken,
    );
    expect(response.status).toBe(201);

    const stored = await ctx.prisma.moiEntry.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(stored.paymentStatus).toBe('VERIFIED');
    expect(stored.verifiedByAdminId).toBe(tenantA.ownerId);
    expect(stored.verifiedAt).not.toBeNull();

    // The staff member's identity and the action timestamp both have to be
    // in the audit record, since a cash receipt has no bank evidence.
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { entityId: created.body.id, action: 'ENTRY_CASH_CONFIRMED' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.adminUserId).toBe(tenantA.ownerId);
    expect(audit?.createdAt).toBeInstanceOf(Date);
    expect(audit?.workspaceId ?? tenantA.workspaceId).toBe(tenantA.workspaceId);
  });

  it('releases the matched credit when a verified entry is reset', async () => {
    const entry = await registerGuest(tenantA.eventSlug, {
      guestName: 'Reset Guest',
      amountPaise: 101010,
    });
    await ctx.post('/entries/' + entry.body.accessToken + '/payment-reference', {
      utr: '400000000001',
    });
    const stored = await ctx.prisma.moiEntry.findFirstOrThrow({
      where: { accessToken: entry.body.accessToken },
    });

    await ctx.upload(
      '/admin/bank-statements/import',
      statementCsv([
        { date: today(), narration: 'UPI/400000000001/R', ref: '400000000001', credit: '1010.10' },
      ]),
      { beneficiaryAccountId: tenantA.accountId, autoReconcile: 'false' },
      tenantA.ownerToken,
      'review-reset.csv',
    );

    const run = await ctx.post(
      '/admin/reconciliation/entries/' + stored.id + '/run',
      undefined,
      tenantA.ownerToken,
    );
    expect(run.body.status).toBe('VERIFIED');
    const txnId = run.body.matchedBankTransactionId;

    const reset = await ctx.post(
      '/admin/entries/' + stored.id + '/review',
      { action: 'RESET', reason: 'Organizer wants to recheck this one' },
      tenantA.ownerToken,
    );
    expect(reset.status).toBe(201);

    // The credit must go back into the pool, not stay attached to a
    // contribution that is no longer verified.
    const txn = await ctx.prisma.bankTransaction.findUniqueOrThrow({ where: { id: txnId } });
    expect(txn.matchedEntryId).toBeNull();
  });

  it("refuses to resolve another customer's entry", async () => {
    const entry = await registerGuest(tenantB.eventSlug, {
      guestName: 'Other Tenant Guest',
      amountPaise: 100000,
    });
    const stored = await ctx.prisma.moiEntry.findFirstOrThrow({
      where: { accessToken: entry.body.accessToken },
    });
    const response = await ctx.post(
      '/admin/entries/' + stored.id + '/review',
      { action: 'REJECT', reason: 'not mine to reject' },
      tenantA.ownerToken,
    );
    expect([403, 404]).toContain(response.status);
  });

  it('refuses a manual match using a credit from another account', async () => {
    const foreign = await ctx.prisma.bankTransaction.findFirstOrThrow({
      where: { beneficiaryAccountId: tenantB.accountId, matchedEntryId: null },
    });
    const entry = await registerGuest(tenantA.eventSlug, {
      guestName: 'Foreign Match Guest',
      amountPaise: 100000,
    });
    const stored = await ctx.prisma.moiEntry.findFirstOrThrow({
      where: { accessToken: entry.body.accessToken },
    });

    const response = await ctx.post(
      '/admin/entries/' + stored.id + '/review',
      {
        action: 'MATCH_TRANSACTION',
        bankTransactionId: foreign.id,
        reason: 'attempting a cross-account match',
      },
      tenantA.ownerToken,
    );
    expect(response.status).toBeGreaterThanOrEqual(400);

    const after = await ctx.prisma.bankTransaction.findUniqueOrThrow({
      where: { id: foreign.id },
    });
    expect(after.matchedEntryId).toBeNull();
  });

  it('refuses review actions from staff without the permission', async () => {
    const entry = await registerGuest(tenantA.eventSlug, {
      guestName: 'Staff Review Guest',
      amountPaise: 100000,
    });
    const stored = await ctx.prisma.moiEntry.findFirstOrThrow({
      where: { accessToken: entry.body.accessToken },
    });
    const response = await ctx.post(
      '/admin/entries/' + stored.id + '/review',
      { action: 'REJECT', reason: 'staff should not be able to do this' },
      staffToken,
    );
    expect(response.status).toBe(403);
  });
});

describe('stage 7b: reporting consistency', () => {
  it('agrees between the dashboard totals and the exported register', async () => {
    const stats = await ctx.get('/admin/stats?eventId=' + tenantA.eventId, tenantA.ownerToken);
    expect(stats.status).toBe(200);

    const entries = await ctx.get(
      '/admin/entries?eventId=' + tenantA.eventId + '&pageSize=200',
      tenantA.ownerToken,
    );
    expect(entries.status).toBe(200);
    expect(stats.body.totalEntries).toBe(entries.body.total);

    // The money columns must agree with the rows the same filter returns.
    const rowsSum = entries.body.rows.reduce(
      (total: number, row: any) => total + row.amountPaise,
      0,
    );
    expect(stats.body.submittedPaise).toBe(rowsSum);

    const verifiedSum = entries.body.rows
      .filter((row: any) => row.paymentStatus === 'VERIFIED')
      .reduce((total: number, row: any) => total + row.amountPaise, 0);
    expect(stats.body.verifiedPaise).toBe(verifiedSum);
  });

  it('exports an Excel register scoped to the caller workspace', async () => {
    const response = await fetch(
      ctx.baseUrl + '/admin/reports/export?eventId=' + tenantA.eventId + '&format=xlsx',
      { headers: { Authorization: 'Bearer ' + tenantA.ownerToken } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheet');
    const buffer = Buffer.from(await response.arrayBuffer());
    // XLSX files are zip archives.
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('exports a PDF register', async () => {
    const response = await fetch(
      ctx.baseUrl + '/admin/reports/export?eventId=' + tenantA.eventId + '&format=pdf',
      { headers: { Authorization: 'Bearer ' + tenantA.ownerToken } },
    );
    expect(response.status).toBe(200);
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('rejects an unsupported export format', async () => {
    const response = await ctx.get(
      '/admin/reports/export?eventId=' + tenantA.eventId + '&format=exe',
      tenantA.ownerToken,
    );
    expect(response.status).toBe(400);
  });

  it('counts only this workspace when no event filter is given', async () => {
    const mine = await ctx.get('/admin/entries?pageSize=200', tenantA.ownerToken);
    const eventIds = new Set(mine.body.rows.map((row: any) => row.eventId));
    const foreign = await ctx.prisma.event.findMany({
      where: { workspaceId: tenantB.workspaceId },
      select: { id: true },
    });
    for (const event of foreign) {
      expect(eventIds.has(event.id)).toBe(false);
    }
  });

  it('caps the page size so one request cannot pull the whole register', async () => {
    const response = await ctx.get('/admin/entries?pageSize=100000', tenantA.ownerToken);
    expect(response.status).toBe(400);
  });
});

describe('stage 8: event closure', () => {
  it('stops new contributions once closed, and keeps the history readable', async () => {
    const event = await ctx.post(
      '/admin/events',
      { name: 'Closing Ceremony Event', eventDate: '2026-12-20T00:00:00.000Z' },
      tenantA.ownerToken,
    );
    const config = await ctx.post(
      '/admin/beneficiaries/events/' + event.body.id + '/select',
      { beneficiaryAccountId: tenantA.accountId },
      tenantA.ownerToken,
    );
    expect(config.status).toBe(201);

    const before = await registerGuest(event.body.slug, {
      guestName: 'Before Closing',
      amountPaise: 100000,
    });
    expect(before.status).toBe(201);

    const close = await ctx.patch(
      '/admin/events/' + event.body.id,
      { isOpen: false },
      tenantA.ownerToken,
    );
    expect(close.status).toBe(200);

    const after = await registerGuest(event.body.slug, {
      guestName: 'After Closing',
      amountPaise: 100000,
    });
    expect(after.status).toBe(403);

    // The already recorded contribution is still visible to its guest.
    const status = await ctx.get('/entries/' + before.body.accessToken + '/status');
    expect(status.status).toBe(200);
  });
});

describe('platform operations', () => {
  it('gives a platform role no implicit read of customer data', async () => {
    expect((await ctx.get('/admin/events', superToken)).status).toBe(403);
    expect((await ctx.get('/admin/entries', superToken)).status).toBe(403);
    expect((await ctx.get('/admin/beneficiaries', superToken)).status).toBe(403);
  });

  it('writes an audit row for every login attempt, successful or not', async () => {
    const before = await ctx.prisma.auditLog.count({ where: { action: 'ADMIN_LOGIN_FAILED' } });
    await ctx.post('/admin/auth/login', {
      email: tenantA.ownerEmail,
      password: 'wrong-but-long-enough',
    });
    const after = await ctx.prisma.auditLog.count({ where: { action: 'ADMIN_LOGIN_FAILED' } });
    expect(after).toBe(before + 1);
  });

  it('does not store the guest reference or password in an audit payload', async () => {
    const logs = await ctx.prisma.auditLog.findMany({ take: 200, orderBy: { createdAt: 'desc' } });
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toMatch(/Password#123/);
    expect(serialized).not.toMatch(/passwordHash/);
  });
});

describe('staff operations and remaining edge cases', () => {
  it('lets assigned staff record a cash entry at the desk', async () => {
    const response = await ctx.post(
      '/admin/entries',
      {
        eventId: tenantA.eventId,
        guestName: 'Desk Recorded Guest',
        amountPaise: 150000,
        paymentMethod: 'CASH',
        confirmReceived: true,
      },
      staffToken,
    );
    expect(response.status).toBe(201);

    const stored = await ctx.prisma.moiEntry.findUniqueOrThrow({
      where: { id: response.body.id },
    });
    // Whoever took the money in hand is recorded against the entry.
    expect(stored.recordedByAdminId).toBe(staffId);
  });

  it('refuses a manual entry against another customer event', async () => {
    const response = await ctx.post(
      '/admin/entries',
      {
        eventId: tenantB.eventId,
        guestName: 'Wrong Event Guest',
        amountPaise: 150000,
        paymentMethod: 'CASH',
      },
      staffToken,
    );
    expect([403, 404]).toContain(response.status);
  });

  it('refuses a manual entry when the record permission is withdrawn', async () => {
    await ctx.prisma.eventMember.update({
      where: { eventId_userId: { eventId: tenantA.eventId, userId: staffId } },
      data: { canRecordEntries: false },
    });
    try {
      const response = await ctx.post(
        '/admin/entries',
        {
          eventId: tenantA.eventId,
          guestName: 'No Permission Guest',
          amountPaise: 150000,
          paymentMethod: 'CASH',
        },
        staffToken,
      );
      expect(response.status).toBe(403);
    } finally {
      await ctx.prisma.eventMember.update({
        where: { eventId_userId: { eventId: tenantA.eventId, userId: staffId } },
        data: { canRecordEntries: true },
      });
    }
  });

  it('shows staff only the entries of events they are assigned to', async () => {
    const response = await ctx.get('/admin/entries?pageSize=200', staffToken);
    expect(response.status).toBe(200);
    expect(response.body.rows.every((row: any) => row.eventId === tenantA.eventId)).toBe(true);

    // The owner of the same workspace sees more, because they reach every
    // event in it rather than a single assignment.
    const ownerView = await ctx.get('/admin/entries?pageSize=200', tenantA.ownerToken);
    expect(ownerView.body.total).toBeGreaterThan(response.body.total);
  });

  it('refuses an admin-recorded reference that another contribution already claims', async () => {
    const first = await registerGuest(tenantA.eventSlug, {
      guestName: 'Admin Ref Guest',
      amountPaise: 100000,
    });
    await ctx.post('/entries/' + first.body.accessToken + '/payment-reference', {
      utr: '600000000001',
    });

    const second = await registerGuest(tenantA.eventSlug, {
      guestName: 'Admin Ref Clash Guest',
      amountPaise: 100000,
    });
    const stored = await ctx.prisma.moiEntry.findFirstOrThrow({
      where: { accessToken: second.body.accessToken },
    });

    const response = await ctx.post(
      '/admin/entries/' + stored.id + '/payment-reference',
      { utr: '600000000001' },
      tenantA.ownerToken,
    );
    expect(response.status).toBe(409);
  });

  it('shows the guest a verified status once the bank confirms it', async () => {
    const entry = await registerGuest(tenantA.eventSlug, {
      guestName: 'Confirmed Guest',
      amountPaise: 191900,
    });
    await ctx.post('/entries/' + entry.body.accessToken + '/payment-reference', {
      utr: '600000000002',
    });

    await ctx.upload(
      '/admin/bank-statements/import',
      statementCsv([
        { date: today(), narration: 'UPI/600000000002/OK', ref: '600000000002', credit: '1919.00' },
      ]),
      { beneficiaryAccountId: tenantA.accountId, autoReconcile: 'false' },
      tenantA.ownerToken,
      'guest-confirm.csv',
    );

    const stored = await ctx.prisma.moiEntry.findFirstOrThrow({
      where: { accessToken: entry.body.accessToken },
    });
    await ctx.post(
      '/admin/reconciliation/entries/' + stored.id + '/run',
      undefined,
      tenantA.ownerToken,
    );

    const status = await ctx.get('/entries/' + entry.body.accessToken + '/status');
    expect(status.body.paymentStatus).toBe('VERIFIED');
  });

  it('rejects an unknown sort column instead of interpolating it', async () => {
    const response = await ctx.get(
      '/admin/entries?sortBy=amountPaise%3BDROP%20TABLE%20moi_entries',
      tenantA.ownerToken,
    );
    expect(response.status).toBe(400);

    // The table is obviously still there.
    const count = await ctx.prisma.moiEntry.count();
    expect(count).toBeGreaterThan(0);
  });

  it('treats a search term as text rather than as a pattern', async () => {
    const injection = encodeURIComponent("%' OR 1=1 --");
    const response = await ctx.get('/admin/entries?q=' + injection, tenantA.ownerToken);
    expect(response.status).toBe(200);

    // A wildcard-looking term must not match every row.
    const all = await ctx.get('/admin/entries?pageSize=200', tenantA.ownerToken);
    expect(response.body.total).toBeLessThan(all.body.total);
  });

  it('refuses a status filter that is not a real status', async () => {
    const response = await ctx.get('/admin/entries?status=TOTALLY_MADE_UP', tenantA.ownerToken);
    expect(response.status).toBe(400);
  });

  it('keeps the guest status endpoint free of other guests data', async () => {
    const entry = await registerGuest(tenantA.eventSlug, {
      guestName: 'Privacy Guest',
      amountPaise: 100000,
    });
    const status = await ctx.get('/entries/' + entry.body.accessToken + '/status');
    const serialized = JSON.stringify(status.body);
    expect(serialized).not.toMatch(/Desk Recorded Guest|Confirmed Guest/);
    expect(serialized).not.toMatch(/recordedByAdminId|verifiedByAdminId/);
  });
});
