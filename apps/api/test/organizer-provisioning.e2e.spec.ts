/**
 * Super admin provisioning of event organizers, end to end.
 *
 * The workflow under test: a platform super admin creates an event together
 * with an organizer login and hands over a one-time password. Each organizer
 * signs in, must replace that password, and from then on sees and manages
 * only their own event: its details, its register, its reports and its
 * activity. Two organizers are provisioned side by side so every isolation
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
  temporaryPassword: string;
  /** Set once the organizer has chosen their own password. */
  password?: string;
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
    temporaryPassword: response.body.temporaryPassword,
  };
}

/** Signs in with the issued password and replaces it, as the UI forces. */
async function completeFirstSignIn(organizer: Organizer, newPassword: string) {
  const firstToken = await ctx.login(organizer.email, organizer.temporaryPassword);
  const changed = await ctx.post(
    '/admin/auth/change-password',
    { currentPassword: organizer.temporaryPassword, newPassword },
    firstToken,
  );
  expect(changed.status).toBe(201);
  organizer.password = newPassword;
  organizer.token = await ctx.login(organizer.email, newPassword);
}

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

    expect(organizerA.temporaryPassword).toMatch(TEMP_PASSWORD_SHAPE);

    const user = await ctx.prisma.adminUser.findUniqueOrThrow({
      where: { id: organizerA.userId },
      include: { memberships: true },
    });
    expect(user.mustChangePassword).toBe(true);
    expect(user.platformRole).toBe('USER');
    expect(user.memberships).toHaveLength(1);
    expect(user.memberships[0]).toMatchObject({
      workspaceId: organizerA.workspaceId,
      role: 'WORKSPACE_OWNER',
      status: 'ACTIVE',
    });

    const event = await ctx.prisma.event.findUniqueOrThrow({ where: { id: organizerA.eventId } });
    expect(event.workspaceId).toBe(organizerA.workspaceId);
    // No payee is chosen for the organizer: the platform never decides where
    // a family's money goes.
    expect(event.activePaymentConfigId).toBeNull();
  });

  it('provisions a second, unrelated organizer', async () => {
    organizerB = await provision('Raman');
    expect(organizerB.workspaceId).not.toBe(organizerA.workspaceId);
    expect(organizerB.temporaryPassword).not.toBe(organizerA.temporaryPassword);
  });

  it('refuses a second login for an email that already has one', async () => {
    const response = await ctx.post(
      '/admin/platform/organizers',
      {
        organizerName: 'Duplicate',
        organizerEmail: organizerA.email.toUpperCase(),
        eventName: 'Another Event',
        eventDate: '2026-12-06T10:00:00.000Z',
      },
      superToken,
    );
    expect(response.status).toBe(409);
    // Nothing half-created by the refused call.
    expect(await ctx.prisma.workspace.count()).toBe(2);
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
    for (const secret of [organizerA.temporaryPassword, organizerB.temporaryPassword]) {
      expect(JSON.stringify(overview.body)).not.toContain(secret);
      expect(JSON.stringify(audit)).not.toContain(secret);
    }
  });

  it('keeps the platform console closed to anyone without a token', async () => {
    expect((await ctx.get('/admin/platform/overview')).status).toBe(401);
  });
});

describe('first sign-in with an issued password', () => {
  let firstToken: string;

  it('signs in and reports that a new password is required', async () => {
    const response = await ctx.post('/admin/auth/login', {
      email: organizerA.email,
      password: organizerA.temporaryPassword,
    });
    expect(response.status).toBe(201);
    firstToken = response.body.accessToken;
    expect(response.body.admin).toMatchObject({
      mustChangePassword: true,
      platformRole: 'USER',
      memberships: [
        {
          workspaceId: organizerA.workspaceId,
          role: 'WORKSPACE_OWNER',
          workspaceStatus: 'ACTIVE',
        },
      ],
    });
  });

  it('refuses every data route until the password is replaced', async () => {
    for (const path of [
      '/admin/events',
      '/admin/entries',
      '/admin/activity',
      '/admin/stats',
      '/admin/beneficiaries',
    ]) {
      const response = await ctx.get(path, firstToken);
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('PASSWORD_CHANGE_REQUIRED');
    }
    expect((await ctx.get('/admin/auth/me', firstToken)).status).toBe(200);
  });

  it('retires the issued password once a new one is chosen', async () => {
    await completeFirstSignIn(organizerA, 'Kumar-own-password-1');

    const me = await ctx.get('/admin/auth/me', organizerA.token);
    expect(me.body.mustChangePassword).toBe(false);

    const reuse = await ctx.post('/admin/auth/login', {
      email: organizerA.email,
      password: organizerA.temporaryPassword,
    });
    expect(reuse.status).toBe(401);

    // The token issued before the change keeps working now the flag is clear.
    expect((await ctx.get('/admin/events', firstToken)).status).toBe(200);
  });

  it('lets the second organizer complete their own first sign-in', async () => {
    await completeFirstSignIn(organizerB, 'Raman-own-password-1');
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

describe('what the super admin can and cannot see', () => {
  it('shows counts and statuses, never guest names or amounts', async () => {
    const overview = await ctx.get('/admin/platform/overview', superToken);
    const workspaceA = overview.body.find(
      (workspace: { id: string }) => workspace.id === organizerA.workspaceId,
    );

    expect(workspaceA.events[0]).toMatchObject({
      id: organizerA.eventId,
      entryCount: 2,
      paymentReady: false,
    });
    expect(workspaceA.members[0]).toMatchObject({
      email: organizerA.email,
      role: 'WORKSPACE_OWNER',
      mustChangePassword: false,
    });
    expect(workspaceA.members[0].lastLoginAt).not.toBeNull();

    const serialized = JSON.stringify(overview.body);
    expect(serialized).not.toContain('Arun Kumar');
    expect(serialized).not.toContain('Meena Rajan');
    expect(serialized).not.toMatch(/amountPaise|verifiedPaise|submittedPaise|passwordHash/);
  });

  it('still has no implicit read of an organizer’s register', async () => {
    expect((await ctx.get('/admin/events', superToken)).status).toBe(403);
    expect((await ctx.get('/admin/entries', superToken)).status).toBe(403);
    expect((await ctx.get('/admin/activity', superToken)).status).toBe(403);
    expect(
      (await ctx.get('/admin/reports/export?format=xlsx&eventId=' + organizerA.eventId, superToken))
        .status,
    ).toBe(403);
  });
});

describe('credential lifecycle', () => {
  it('resets a forgotten password with a new one-time password', async () => {
    const tokenBeforeReset = organizerA.token!;
    const reset = await ctx.post(
      '/admin/platform/users/' + organizerA.userId + '/reset-password',
      {},
      superToken,
    );
    expect(reset.status).toBe(201);
    expect(reset.body.temporaryPassword).toMatch(TEMP_PASSWORD_SHAPE);

    // The password the organizer chose no longer works...
    const old = await ctx.post('/admin/auth/login', {
      email: organizerA.email,
      password: organizerA.password,
    });
    expect(old.status).toBe(401);

    // ...and a session opened before the reset is held at the change form.
    const held = await ctx.get('/admin/events', tokenBeforeReset);
    expect(held.status).toBe(403);
    expect(held.body.error).toBe('PASSWORD_CHANGE_REQUIRED');

    organizerA.temporaryPassword = reset.body.temporaryPassword;
    await completeFirstSignIn(organizerA, 'Kumar-own-password-2');
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
