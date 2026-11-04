/**
 * Super admin provisioning of event organizers, end to end.
 *
 * The workflow under test: the platform super admin has full control. Only
 * they create events, each against a chosen organizer, and they set that
 * organizer's UPI account. They hand over a one-time password; the organizer
 * signs in, must replace it, and from then on sees and manages only their own
 * event: its details, its register, its reports and its activity. The super
 * admin can open any organizer's register and export its reports. Organizers
 * never set their own password: the super admin issues it and resets it. Two organizers are provisioned side by side so every isolation
 * claim is checked against a real neighbour rather than an empty database.
 *
 * Runs against a throwaway Postgres (TEST_DATABASE_URL), like the other e2e
 * suites, over real HTTP.
 */
import * as bcrypt from 'bcryptjs';
import { E2EContext } from './helpers/e2e-app';

const ctx = new E2EContext();
const PASSWORD = 'Password#123';
const TEMP_PASSWORD_SHAPE = /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/;

let superToken: string;
let superAdminId: string;

interface Organizer {
  email: string;
  userId: string;
  workspaceId: string;
  eventId: string;
  eventSlug: string;
  /** Issued by the super admin; the organizer cannot change it. */
  password: string;
  token?: string;
}

let organizerA: Organizer;
let organizerB: Organizer;

async function createPlatformUser(email: string) {
  return ctx.prisma.adminUser.create({
    data: {
      email,
      name: 'Platform ' + email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      platformRole: 'SUPER_ADMIN',
    },
  });
}

async function provision(key: string): Promise<Organizer> {
  const response = await ctx.post(
    '/admin/platform/organizers',
    {
      organizerName: key + ' Organizer',
      organizerEmail: key.toLowerCase() + '.organizer@test.local',
      organizerPhone: '98765 43210',
      eventName: key + ' Wedding Reception',
      eventDate: '2026-12-05T10:00:00.000Z',
      hostName: key + ' Family',
      venue: key + ' Mahal',
      upiId: key.toLowerCase() + '.family@okicici',
      payeeName: key + ' Family',
    },
    superToken,
  );
  expect(response.status).toBe(201);
  return {
    email: response.body.organizer.email,
    userId: response.body.organizer.id,
    workspaceId: response.body.workspace.id,
    eventId: response.body.event.id,
    eventSlug: response.body.event.slug,
    password: response.body.password,
  };
}

async function signIn(organizer: Organizer) {
  organizer.token = await ctx.login(organizer.email, organizer.password);
}

/** iat has one-second resolution; wait so a new token is not "before" a reset. */
const nextSecond = () => new Promise((resolve) => setTimeout(resolve, 1100));

beforeAll(async () => {
  await ctx.start();
  const platform = await createPlatformUser('ops@test.local');
  superAdminId = platform.id;
  superToken = await ctx.login(platform.email, PASSWORD);
}, 120_000);

afterAll(async () => {
  await ctx.stop();
});

describe('super admin provisions organizers', () => {
  it('creates the workspace, the event and an owner login in one call', async () => {
    organizerA = await provision('Kumar');

    expect(organizerA.password).toMatch(TEMP_PASSWORD_SHAPE);

    const user = await ctx.prisma.adminUser.findUniqueOrThrow({
      where: { id: organizerA.userId },
      include: { memberships: true },
    });
    expect(user.mustChangePassword).toBe(false);
    expect(user.platformRole).toBe('USER');
    expect(user.memberships).toHaveLength(1);
    expect(user.memberships[0]).toMatchObject({
      workspaceId: organizerA.workspaceId,
      role: 'WORKSPACE_OWNER',
      status: 'ACTIVE',
    });

    const event = await ctx.prisma.event.findUniqueOrThrow({
      where: { id: organizerA.eventId },
      include: { activePaymentConfig: { include: { beneficiaryAccount: true } } },
    });
    expect(event.workspaceId).toBe(organizerA.workspaceId);
    // The super admin set the organizer's UPI account, so the event can take
    // UPI payments straight away.
    expect(event.activePaymentConfig?.upiIdSnapshot).toBe('kumar.family@okicici');
    expect(event.activePaymentConfig?.beneficiaryAccount.status).toBe('CONFIRMED');
    expect(event.activePaymentConfig?.beneficiaryAccount.workspaceId).toBe(
      organizerA.workspaceId,
    );
  });

  it('provisions a second, unrelated organizer', async () => {
    organizerB = await provision('Raman');
    expect(organizerB.workspaceId).not.toBe(organizerA.workspaceId);
    expect(organizerB.password).not.toBe(organizerA.password);
  });

  it('refuses a second login for an email that already has one', async () => {
    const response = await ctx.post(
      '/admin/platform/organizers',
      {
        organizerName: 'Duplicate',
        organizerEmail: organizerA.email.toUpperCase(),
        eventName: 'Another Event',
        eventDate: '2026-12-06T10:00:00.000Z',
        upiId: 'dup@okicici',
        payeeName: 'Duplicate',
      },
      superToken,
    );
    expect(response.status).toBe(409);
    // Nothing half-created by the refused call.
    expect(await ctx.prisma.workspace.count()).toBe(2);
  });

  it('requires the organizer UPI account', async () => {
    const response = await ctx.post(
      '/admin/platform/organizers',
      {
        organizerName: 'No UPI',
        organizerEmail: 'noupi@test.local',
        eventName: 'No UPI Event',
        eventDate: '2026-12-06T10:00:00.000Z',
      },
      superToken,
    );
    expect(response.status).toBe(400);
    expect(await ctx.prisma.adminUser.count({ where: { email: 'noupi@test.local' } })).toBe(0);
  });

  it('validates the request before creating anything', async () => {
    const response = await ctx.post(
      '/admin/platform/organizers',
      { organizerName: 'No Date', organizerEmail: 'nodate@test.local', eventName: 'Event' },
      superToken,
    );
    expect(response.status).toBe(400);
    expect(await ctx.prisma.adminUser.count({ where: { email: 'nodate@test.local' } })).toBe(0);
  });

  it('never stores or repeats the issued password', async () => {
    const overview = await ctx.get('/admin/platform/overview', superToken);
    expect(overview.status).toBe(200);
    const audit = await ctx.prisma.auditLog.findMany();
    for (const secret of [organizerA.password, organizerB.password]) {
      expect(JSON.stringify(overview.body)).not.toContain(secret);
      expect(JSON.stringify(audit)).not.toContain(secret);
    }
  });

  it('keeps the platform console closed to anyone without a token', async () => {
    expect((await ctx.get('/admin/platform/overview')).status).toBe(401);
  });
});

describe('organizer sign-in', () => {
  it('signs in with the issued password and goes straight to the event', async () => {
    const response = await ctx.post('/admin/auth/login', {
      email: organizerA.email,
      password: organizerA.password,
    });
    expect(response.status).toBe(201);
    expect(response.body.admin).toMatchObject({
      mustChangePassword: false,
      platformRole: 'USER',
      memberships: [
        { workspaceId: organizerA.workspaceId, role: 'WORKSPACE_OWNER', workspaceStatus: 'ACTIVE' },
      ],
    });
    organizerA.token = response.body.accessToken;
    expect((await ctx.get('/admin/events', organizerA.token)).status).toBe(200);
  });

  it('does not let an organizer change their own password', async () => {
    const response = await ctx.post(
      '/admin/auth/change-password',
      { currentPassword: organizerA.password, newPassword: 'Organizer-chosen-1' },
      organizerA.token,
    );
    expect(response.status).toBe(403);

    // The issued password still works; nothing changed.
    expect((await ctx.post('/admin/auth/login', {
      email: organizerA.email,
      password: organizerA.password,
    })).status).toBe(201);
    expect((await ctx.post('/admin/auth/login', {
      email: organizerA.email,
      password: 'Organizer-chosen-1',
    })).status).toBe(401);
  });

  it('signs in the second organizer', async () => {
    await signIn(organizerB);
    expect((await ctx.get('/admin/events', organizerB.token)).status).toBe(200);
  });
});

describe('each organizer sees only their own event', () => {
  it('lists only the organizer’s own event', async () => {
    const a = await ctx.get('/admin/events', organizerA.token);
    expect(a.body.map((event: { id: string }) => event.id)).toEqual([organizerA.eventId]);

    const b = await ctx.get('/admin/events', organizerB.token);
    expect(b.body.map((event: { id: string }) => event.id)).toEqual([organizerB.eventId]);
  });

  it('refuses to read or change the other organizer’s event', async () => {
    const read = await ctx.get('/admin/events/' + organizerB.eventId, organizerA.token);
    expect([403, 404]).toContain(read.status);

    const write = await ctx.patch(
      '/admin/events/' + organizerB.eventId,
      { venue: 'Hijacked' },
      organizerA.token,
    );
    expect([403, 404]).toContain(write.status);

    const event = await ctx.prisma.event.findUniqueOrThrow({ where: { id: organizerB.eventId } });
    expect(event.venue).toBe('Raman Mahal');
  });

  it('lets the organizer fill in their own event details', async () => {
    const response = await ctx.patch(
      '/admin/events/' + organizerA.eventId,
      {
        name: 'Kumar & Priya Wedding Reception',
        hostName: 'Kumar & Lakshmi',
        venue: 'Sri Krishna Mahal, Coimbatore',
        eventDate: '2026-12-06T10:00:00.000Z',
        suggestedAmounts: [10100, 50100, 100100],
        collectPhone: true,
      },
      organizerA.token,
    );
    expect(response.status).toBe(200);

    const event = await ctx.prisma.event.findUniqueOrThrow({ where: { id: organizerA.eventId } });
    expect(event).toMatchObject({
      name: 'Kumar & Priya Wedding Reception',
      hostName: 'Kumar & Lakshmi',
      venue: 'Sri Krishna Mahal, Coimbatore',
      suggestedAmounts: [10100, 50100, 100100],
      collectPhone: true,
    });
  });

  it('does not let an organizer create events or change the UPI account', async () => {
    const create = await ctx.post(
      '/admin/events',
      { name: 'Organizer made event', eventDate: '2026-12-07T10:00:00.000Z' },
      organizerA.token,
    );
    expect(create.status).toBe(403);

    const account = await ctx.post(
      '/admin/beneficiaries',
      { label: 'Mine', upiId: 'kumar.other@okicici', payeeName: 'Kumar' },
      organizerA.token,
    );
    expect(account.status).toBe(403);

    // Reading the configured account is still allowed.
    const list = await ctx.get('/admin/beneficiaries', organizerA.token);
    expect(list.status).toBe(200);
    expect(list.body.map((row: { upiId: string }) => row.upiId)).toEqual(['kumar.family@okicici']);
  });

  it('exports a report for the organizer’s own event only', async () => {
    const own = await ctx.get(
      '/admin/reports/export?format=xlsx&eventId=' + organizerA.eventId,
      organizerA.token,
    );
    expect(own.status).toBe(200);

    const other = await ctx.get(
      '/admin/reports/export?format=xlsx&eventId=' + organizerB.eventId,
      organizerA.token,
    );
    expect(other.status).toBe(403);
  });

  it('keeps the platform console closed to organizers', async () => {
    expect((await ctx.get('/admin/platform/overview', organizerA.token)).status).toBe(403);
    const provisionAttempt = await ctx.post(
      '/admin/platform/organizers',
      {
        organizerName: 'Sneaky',
        organizerEmail: 'sneaky@test.local',
        eventName: 'Sneaky Event',
        eventDate: '2026-12-06T10:00:00.000Z',
        upiId: 'sneaky@okicici',
        payeeName: 'Sneaky',
      },
      organizerA.token,
    );
    expect(provisionAttempt.status).toBe(403);
    expect(
      (await ctx.post('/admin/platform/users/' + organizerB.userId + '/reset-password', {}, organizerA.token))
        .status,
    ).toBe(403);
  });
});

describe('activity feed', () => {
  it('records what happened on the organizer’s event, attributed to who did it', async () => {
    // A guest registration and an organizer-recorded cash entry. The second
    // is written by a code path that never passed a workspace to the audit
    // log, which is exactly what the derivation exists to fix.
    const guest = await ctx.post('/events/' + organizerA.eventSlug + '/entries', {
      guestName: 'Arun Kumar',
      amountPaise: 100000,
      paymentMethod: 'CASH',
    });
    expect(guest.status).toBe(201);

    const manual = await ctx.post(
      '/admin/entries',
      {
        eventId: organizerA.eventId,
        guestName: 'Meena Rajan',
        amountPaise: 250000,
        paymentMethod: 'CASH',
        confirmReceived: true,
      },
      organizerA.token,
    );
    expect(manual.status).toBe(201);

    const feed = await ctx.get('/admin/activity', organizerA.token);
    expect(feed.status).toBe(200);
    const actions = feed.body.rows.map((row: { action: string }) => row.action);

    expect(actions).toEqual(
      expect.arrayContaining([
        'PLATFORM_ORGANIZER_PROVISIONED',
        'EVENT_CREATED',
        'EVENT_UPDATED',
        'ENTRY_CREATED',
        'ENTRY_CREATED_CASH_CONFIRMED',
        'REPORT_EXPORTED',
      ]),
    );

    const byAction = (action: string) =>
      feed.body.rows.find((row: { action: string }) => row.action === action);
    expect(byAction('ENTRY_CREATED').actor).toEqual({ kind: 'GUEST', name: null });
    expect(byAction('ENTRY_CREATED_CASH_CONFIRMED').actor).toEqual({
      kind: 'TEAM',
      name: 'Kumar Organizer',
    });
    expect(byAction('ENTRY_CREATED_CASH_CONFIRMED').eventId).toBe(organizerA.eventId);
    expect(byAction('EVENT_CREATED').actor.kind).toBe('PLATFORM');
  });

  it('contains nothing from the other organizer’s workspace', async () => {
    const feed = await ctx.get('/admin/activity?limit=200', organizerA.token);
    for (const row of feed.body.rows) {
      expect(row.eventId === null || row.eventId === organizerA.eventId).toBe(true);
    }
    expect(JSON.stringify(feed.body)).not.toContain(organizerB.eventId);
    expect(JSON.stringify(feed.body)).not.toContain('Raman');
  });

  it('refuses a feed for an event the caller cannot see', async () => {
    const response = await ctx.get('/admin/activity?eventId=' + organizerB.eventId, organizerA.token);
    expect(response.status).toBe(403);
  });

  it('does not expose guest IP addresses', async () => {
    const feed = await ctx.get('/admin/activity', organizerA.token);
    expect(JSON.stringify(feed.body)).not.toMatch(/"ip"/);
  });

  it('pages with a cursor instead of returning the whole history', async () => {
    const first = await ctx.get('/admin/activity?limit=2', organizerA.token);
    expect(first.body.rows).toHaveLength(2);
    expect(first.body.hasMore).toBe(true);

    const second = await ctx.get(
      '/admin/activity?limit=2&before=' + encodeURIComponent(first.body.nextBefore),
      organizerA.token,
    );
    expect(second.status).toBe(200);
    const firstIds = first.body.rows.map((row: { id: string }) => row.id);
    for (const row of second.body.rows) expect(firstIds).not.toContain(row.id);
  });
});

describe('the super admin sees and runs every event', () => {
  it('shows each event’s payee and money totals in the console', async () => {
    const overview = await ctx.get('/admin/platform/overview', superToken);
    const workspaceA = overview.body.find(
      (workspace: { id: string }) => workspace.id === organizerA.workspaceId,
    );

    expect(workspaceA.events[0]).toMatchObject({
      id: organizerA.eventId,
      entryCount: 2,
      paymentReady: true,
      upiId: 'kumar.family@okicici',
      totals: { submittedPaise: 350000, verifiedPaise: 250000, verifiedCount: 1 },
    });
    expect(workspaceA.members[0]).toMatchObject({
      email: organizerA.email,
      role: 'WORKSPACE_OWNER',
      mustChangePassword: false,
    });
    expect(JSON.stringify(overview.body)).not.toMatch(/passwordHash/);
  });

  it('reads an organizer’s register and exports its report when it names the workspace', async () => {
    // No workspace named: refused rather than guessing.
    expect((await ctx.get('/admin/entries', superToken)).status).toBe(403);

    const entries = await ctx.call('GET', '/admin/entries?eventId=' + organizerA.eventId, {
      token: superToken,
    });
    expect(entries.status).toBe(200);
    expect(entries.body.rows.map((row: { guestName: string }) => row.guestName).sort()).toEqual([
      'Arun Kumar',
      'Meena Rajan',
    ]);

    const viaHeader = await fetch(ctx.baseUrl + '/admin/activity', {
      headers: { Authorization: 'Bearer ' + superToken, 'X-Workspace-Id': organizerA.workspaceId },
    });
    expect(viaHeader.status).toBe(200);

    const report = await ctx.get(
      '/admin/reports/export?format=pdf&eventId=' + organizerA.eventId,
      superToken,
    );
    expect(report.status).toBe(200);
  });

  it('creates another event for an organizer from the organizer’s own workspace', async () => {
    const created = await ctx.post(
      '/admin/events',
      {
        workspaceId: organizerB.workspaceId,
        name: 'Raman Engagement',
        eventDate: '2026-11-20T10:00:00.000Z',
      },
      superToken,
    );
    expect(created.status).toBe(201);
    const stored = await ctx.prisma.event.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.workspaceId).toBe(organizerB.workspaceId);
    // Remove it again so the rest of the suite sees one event for B.
    await ctx.prisma.event.delete({ where: { id: created.body.id } });
  });
});

describe('credential lifecycle', () => {
  it('lets only the super admin set an organizer password, ending old sessions', async () => {
    const tokenBeforeReset = organizerA.token!;
    await nextSecond();

    const chosen = await ctx.post(
      '/admin/platform/users/' + organizerA.userId + '/reset-password',
      { password: 'Chosen-by-super-1' },
      superToken,
    );
    expect(chosen.status).toBe(201);
    expect(chosen.body.password).toBe('Chosen-by-super-1');

    // The previous password no longer works...
    const old = await ctx.post('/admin/auth/login', {
      email: organizerA.email,
      password: organizerA.password,
    });
    expect(old.status).toBe(401);
    // ...and a session opened with it is closed.
    expect((await ctx.get('/admin/events', tokenBeforeReset)).status).toBe(401);

    organizerA.password = 'Chosen-by-super-1';
    await nextSecond();
    await signIn(organizerA);
    expect((await ctx.get('/admin/events', organizerA.token)).status).toBe(200);

    // Too short a chosen password is refused.
    const short = await ctx.post(
      '/admin/platform/users/' + organizerA.userId + '/reset-password',
      { password: 'short' },
      superToken,
    );
    expect(short.status).toBe(400);
  });

  it('generates a password when the super admin does not type one', async () => {
    await nextSecond();
    const generated = await ctx.post(
      '/admin/platform/users/' + organizerA.userId + '/reset-password',
      {},
      superToken,
    );
    expect(generated.status).toBe(201);
    expect(generated.body.password).toMatch(TEMP_PASSWORD_SHAPE);
    organizerA.password = generated.body.password;
    await nextSecond();
    await signIn(organizerA);
    expect((await ctx.get('/admin/events', organizerA.token)).status).toBe(200);
  });

  it('cannot be used against platform administrators or the caller', async () => {
    const otherOperator = await createPlatformUser('ops2@test.local');

    const other = await ctx.post(
      '/admin/platform/users/' + otherOperator.id + '/reset-password',
      {},
      superToken,
    );
    expect(other.status).toBe(403);

    const self = await ctx.post(
      '/admin/platform/users/' + superAdminId + '/reset-password',
      {},
      superToken,
    );
    expect(self.status).toBe(400);

    const deactivate = await ctx.patch(
      '/admin/platform/users/' + otherOperator.id,
      { isActive: false },
      superToken,
    );
    expect(deactivate.status).toBe(403);
  });

  it('revokes a login immediately and restores it on request', async () => {
    const off = await ctx.patch(
      '/admin/platform/users/' + organizerB.userId,
      { isActive: false },
      superToken,
    );
    expect(off.status).toBe(200);
    expect((await ctx.get('/admin/events', organizerB.token)).status).toBe(401);
    expect(
      (await ctx.post('/admin/auth/login', { email: organizerB.email, password: organizerB.password }))
        .status,
    ).toBe(401);

    const on = await ctx.patch(
      '/admin/platform/users/' + organizerB.userId,
      { isActive: true },
      superToken,
    );
    expect(on.status).toBe(200);
    organizerB.token = await ctx.login(organizerB.email, organizerB.password);
    expect((await ctx.get('/admin/events', organizerB.token)).status).toBe(200);
  });

  it('suspends a workspace: admin access and the guest form both close', async () => {
    const noReason = await ctx.patch(
      '/admin/platform/workspaces/' + organizerB.workspaceId,
      { status: 'SUSPENDED' },
      superToken,
    );
    expect(noReason.status).toBe(400);

    const suspended = await ctx.patch(
      '/admin/platform/workspaces/' + organizerB.workspaceId,
      { status: 'SUSPENDED', reason: 'Payment dispute under review' },
      superToken,
    );
    expect(suspended.status).toBe(200);

    expect((await ctx.get('/admin/events', organizerB.token)).status).toBe(403);
    const guest = await ctx.post('/events/' + organizerB.eventSlug + '/entries', {
      guestName: 'Late Guest',
      amountPaise: 50000,
      paymentMethod: 'CASH',
    });
    expect(guest.status).toBe(403);

    // The neighbour is unaffected.
    expect((await ctx.get('/admin/events', organizerA.token)).status).toBe(200);

    const restored = await ctx.patch(
      '/admin/platform/workspaces/' + organizerB.workspaceId,
      { status: 'ACTIVE' },
      superToken,
    );
    expect(restored.status).toBe(200);
    expect((await ctx.get('/admin/events', organizerB.token)).status).toBe(200);
  });

  it('adds another event to an existing organizer without a second login', async () => {
    const added = await ctx.post(
      '/admin/platform/workspaces/' + organizerA.workspaceId + '/events',
      { eventName: 'Kumar Engagement', eventDate: '2026-11-01T10:00:00.000Z' },
      superToken,
    );
    expect(added.status).toBe(201);
    const addedEvent = await ctx.prisma.event.findUniqueOrThrow({
      where: { id: added.body.id },
      include: { activePaymentConfig: true },
    });
    expect(addedEvent.activePaymentConfig?.upiIdSnapshot).toBe('kumar.family@okicici');

    const a = await ctx.get('/admin/events', organizerA.token);
    expect(a.body.map((event: { id: string }) => event.id).sort()).toEqual(
      [organizerA.eventId, added.body.id].sort(),
    );
    const b = await ctx.get('/admin/events', organizerB.token);
    expect(b.body).toHaveLength(1);
  });
});

describe('event staff see only their assigned event in the feed', () => {
  it('filters the feed to the assignment and fails closed on workspace rows', async () => {
    const events = await ctx.prisma.event.findMany({
      where: { workspaceId: organizerA.workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    expect(events).toHaveLength(2);
    const [assigned, other] = events;

    const staff = await ctx.prisma.adminUser.create({
      data: {
        email: 'desk@test.local',
        name: 'Registration Desk',
        passwordHash: await bcrypt.hash(PASSWORD, 4),
      },
    });
    await ctx.prisma.workspaceMember.create({
      data: {
        workspaceId: organizerA.workspaceId,
        userId: staff.id,
        role: 'EVENT_STAFF',
        status: 'ACTIVE',
      },
    });
    await ctx.prisma.eventMember.create({
      data: { eventId: assigned.id, userId: staff.id, canRecordEntries: true },
    });

    // Activity on the event the staff member is NOT assigned to.
    await ctx.patch('/admin/events/' + other.id, { venue: 'Other venue' }, organizerA.token);

    const staffToken = await ctx.login('desk@test.local', PASSWORD);
    const feed = await ctx.get('/admin/activity?limit=200', staffToken);
    expect(feed.status).toBe(200);
    expect(feed.body.rows.length).toBeGreaterThan(0);
    for (const row of feed.body.rows) expect(row.eventId).toBe(assigned.id);

    const refused = await ctx.get('/admin/activity?eventId=' + other.id, staffToken);
    expect(refused.status).toBe(403);
  });
});
