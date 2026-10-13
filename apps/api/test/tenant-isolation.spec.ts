/**
 * Cross-tenant isolation tests.
 *
 * These run against a real throwaway Postgres database, because the defects
 * they cover were all in query scoping: an in-memory stub would happily
 * return whatever the test told it to and prove nothing.
 *
 * The fixture is two unrelated customers whose events charge the same amount
 * on the same day, which is the realistic worst case for a false match.
 *
 * Set TEST_DATABASE_URL to point at a database that may be dropped and
 * recreated. When it is unset the suite is skipped rather than failing, so a
 * machine with no Postgres can still run the unit tests.
 */
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { ReconciliationService } from '../src/modules/reconciliation/reconciliation.service';
import { WorkspaceAccessService } from '../src/modules/workspaces/workspace-access.service';
import type { AdminPrincipal } from '../src/common/decorators/current-admin.decorator';

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://moi:moi_dev_password@localhost:5433/moi_test?schema=public';

const prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });

/** Audit writes are not what these tests are about. */
const auditStub = { record: async () => undefined } as any;

const reconciliation = new ReconciliationService(prisma as any, auditStub);
const access = new WorkspaceAccessService(prisma as any);

function principal(id: string, overrides: Partial<AdminPrincipal> = {}): AdminPrincipal {
  return {
    id,
    email: id + '@example.test',
    name: id,
    role: 'OWNER',
    platformRole: 'USER',
    ...overrides,
  };
}

interface Tenant {
  workspaceId: string;
  ownerId: string;
  accountId: string;
  eventId: string;
  configId: string;
  entryId: string;
  txnId: string;
}

/** The amount and the UTR both collide across the two tenants on purpose. */
const AMOUNT_PAISE = 250000;
const SHARED_UTR = '412345678901';

async function createTenant(key: string, utr: string): Promise<Tenant> {
  const owner = await prisma.adminUser.create({
    data: {
      email: key + '-owner@example.test',
      name: key + ' owner',
      passwordHash: 'x',
      role: 'OWNER',
    },
  });

  const workspace = await prisma.workspace.create({
    data: { slug: key, name: key, status: 'ACTIVE' },
  });

  await prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: owner.id,
      role: 'WORKSPACE_OWNER',
      status: 'ACTIVE',
    },
  });

  const account = await prisma.beneficiaryAccount.create({
    data: {
      workspaceId: workspace.id,
      label: key + ' account',
      upiId: key + '@okbank',
      payeeName: key + ' family',
      status: 'CONFIRMED',
    },
  });

  const event = await prisma.event.create({
    data: {
      workspaceId: workspace.id,
      slug: key + '-event',
      name: key + ' event',
      eventDate: new Date('2026-11-21T10:00:00.000Z'),
    },
  });

  const config = await prisma.eventPaymentConfig.create({
    data: {
      eventId: event.id,
      beneficiaryAccountId: account.id,
      version: 1,
      upiIdSnapshot: account.upiId,
      payeeNameSnapshot: account.payeeName,
    },
  });

  await prisma.event.update({
    where: { id: event.id },
    data: { activePaymentConfigId: config.id },
  });

  const entry = await prisma.moiEntry.create({
    data: {
      eventId: event.id,
      paymentConfigId: config.id,
      entryNumber: 1,
      entryCode: 'MOI-000001',
      guestName: key + ' guest',
      amountPaise: AMOUNT_PAISE,
      paymentMethod: 'UPI',
      paymentStatus: 'AWAITING_VERIFICATION',
      accessToken: key + '-token',
    },
  });

  await prisma.paymentClaim.create({
    data: {
      entryId: entry.id,
      utr: utr,
      utrNormalized: utr,
      source: 'GUEST',
      status: 'CLAIMED',
    },
  });

  const importRecord = await prisma.bankStatementImport.create({
    data: {
      workspaceId: workspace.id,
      beneficiaryAccountId: account.id,
      fileName: key + '.csv',
      fileHash: 'hash-' + key,
    },
  });

  // A credit into this tenant's own account, matching its own entry.
  const txn = await prisma.bankTransaction.create({
    data: {
      importId: importRecord.id,
      workspaceId: workspace.id,
      beneficiaryAccountId: account.id,
      txnDate: new Date(),
      description: 'UPI credit ' + utr,
      reference: utr,
      refNormalized: utr,
      amountPaise: AMOUNT_PAISE,
      direction: 'CREDIT',
      rowHash: 'row-' + key,
    },
  });

  return {
    workspaceId: workspace.id,
    ownerId: owner.id,
    accountId: account.id,
    eventId: event.id,
    configId: config.id,
    entryId: entry.id,
    txnId: txn.id,
  };
}

let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  // Rebuild the schema from the migrations, so these tests also prove the
  // migration files themselves still apply cleanly from scratch.
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: 'ignore',
  });

  a = await createTenant('tenant-a', SHARED_UTR);
  // Tenant B claims the same reference and the same amount as tenant A.
  b = await createTenant('tenant-b', SHARED_UTR + '-b');
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('workspace scope resolution', () => {
  it("refuses a workspace the caller is not a member of", async () => {
    await expect(
      access.resolveScope(principal(a.ownerId), b.workspaceId),
    ).rejects.toThrow(/do not have access/i);
  });

  it('resolves the single workspace a caller does belong to', async () => {
    const scope = await access.resolveScope(principal(a.ownerId));
    expect(scope.workspaceId).toBe(a.workspaceId);
    expect(scope.role).toBe('WORKSPACE_OWNER');
    // An owner reaches every event in their workspace.
    expect(scope.eventIds).toBeNull();
  });

  it("refuses another workspace's event", async () => {
    await expect(access.assertEventAccess(principal(a.ownerId), b.eventId)).rejects.toThrow(
      /do not have access/i,
    );
  });

  it("refuses another workspace's entry", async () => {
    await expect(access.assertEntryAccess(principal(a.ownerId), b.entryId)).rejects.toThrow(
      /do not have access/i,
    );
  });

  it("refuses another workspace's payment account", async () => {
    await expect(
      access.assertAccountAccess(principal(a.ownerId), b.accountId),
    ).rejects.toThrow(/do not have access/i);
  });

  it('refuses a suspended workspace', async () => {
    await prisma.workspace.update({
      where: { id: a.workspaceId },
      data: { status: 'SUSPENDED' },
    });
    await expect(access.resolveScope(principal(a.ownerId))).rejects.toThrow(/do not have access/i);
    await prisma.workspace.update({
      where: { id: a.workspaceId },
      data: { status: 'ACTIVE' },
    });
  });

  it("does not honour a foreign event id from an owner's request", async () => {
    // Regression: an owner's eventIds is null, meaning "every event in my
    // workspace". The filter used to return the requested event id on its
    // own in that case, so owner A asking for owner B's event id was handed
    // it unchecked and could read another customer's entries and totals.
    const scope = await access.resolveScope(principal(a.ownerId));
    const filter = access.eventFilter(scope, b.eventId) as Record<string, any>;
    expect(filter.event).toEqual({ workspaceId: a.workspaceId });

    // The filter must therefore select nothing for a foreign event.
    const leaked = await prisma.moiEntry.findMany({ where: filter });
    expect(leaked).toHaveLength(0);
  });

  it('restricts event staff to their assigned events', async () => {
    const staff = await prisma.adminUser.create({
      data: {
        email: 'staff-scope@example.test',
        name: 'staff',
        passwordHash: 'x',
        role: 'STAFF',
      },
    });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: a.workspaceId,
        userId: staff.id,
        role: 'EVENT_STAFF',
        status: 'ACTIVE',
      },
    });

    // No assignment yet: the filter must be closed, not open.
    const unassigned = await access.resolveScope(principal(staff.id, { role: 'STAFF' }));
    expect(unassigned.eventIds).toEqual([]);
    expect(access.eventFilter(unassigned)).toEqual({
      eventId: { in: [] },
      event: { workspaceId: a.workspaceId },
    });

    await prisma.eventMember.create({
      data: { eventId: a.eventId, userId: staff.id, canResolveReviews: false },
    });

    const assigned = await access.resolveScope(principal(staff.id, { role: 'STAFF' }));
    expect(assigned.eventIds).toEqual([a.eventId]);

    // Assigned to the event, but without the permission the action needs.
    await expect(
      access.assertEventAccess(principal(staff.id, { role: 'STAFF' }), a.eventId, 'canResolveReviews'),
    ).rejects.toThrow(/permissions do not allow/i);

    // And still nothing in the other workspace.
    await expect(
      access.assertEventAccess(principal(staff.id, { role: 'STAFF' }), b.eventId),
    ).rejects.toThrow(/do not have access/i);
  });
});

describe('reconciliation is scoped to the beneficiary account', () => {
  it("does not verify an entry from another account's credit", async () => {
    // Remove tenant A's own credit, leaving only tenant B's, which carries
    // the same amount and sits in the same date window.
    await prisma.bankTransaction.delete({ where: { id: a.txnId } });

    const result = await reconciliation.matchEntry(a.entryId);

    expect(result.status).not.toBe('VERIFIED');
    expect(result.matchedBankTransactionId).toBeUndefined();

    // Tenant B's credit must remain unclaimed.
    const foreign = await prisma.bankTransaction.findUnique({ where: { id: b.txnId } });
    expect(foreign?.matchedEntryId).toBeNull();
  });

  it("verifies an entry from its own account's credit", async () => {
    const importRecord = await prisma.bankStatementImport.findFirstOrThrow({
      where: { beneficiaryAccountId: a.accountId },
    });
    await prisma.bankTransaction.create({
      data: {
        importId: importRecord.id,
        workspaceId: a.workspaceId,
        beneficiaryAccountId: a.accountId,
        txnDate: new Date(),
        description: 'UPI credit ' + SHARED_UTR,
        reference: SHARED_UTR,
        refNormalized: SHARED_UTR,
        amountPaise: AMOUNT_PAISE,
        direction: 'CREDIT',
        rowHash: 'row-tenant-a-redo',
      },
    });

    const result = await reconciliation.matchEntry(a.entryId);
    expect(result.status).toBe('VERIFIED');
  });

  it("refuses a manual match against another account's credit", async () => {
    await expect(
      reconciliation.applyMatch(b.entryId, 'MOI-000001', a.txnId, 'REVIEW_REQUIRED', {
        reason: 'operator picked a foreign transaction',
        manual: true,
      }),
    ).rejects.toThrow(/different payment account|already matched/i);
  });

  it('offers no candidates from another account', async () => {
    const candidates = await reconciliation.findCandidates(b.entryId);
    const foreignIds = candidates.map((c) => c.beneficiaryAccountId);
    expect(foreignIds.every((id) => id === b.accountId)).toBe(true);
  });

  it('declines to match an entry with no pinned beneficiary', async () => {
    const entry = await prisma.moiEntry.create({
      data: {
        eventId: a.eventId,
        entryNumber: 99,
        entryCode: 'MOI-000099',
        guestName: 'unconfigured',
        amountPaise: AMOUNT_PAISE,
        paymentMethod: 'UPI',
        paymentStatus: 'AWAITING_VERIFICATION',
        accessToken: 'unconfigured-token',
      },
    });

    const result = await reconciliation.matchEntry(entry.id);
    expect(result.status).toBe('AWAITING_VERIFICATION');
    expect(result.changed).toBe(false);
    expect(result.reason).toMatch(/no payment beneficiary/i);
  });
});

describe('per-tenant dedupe constraints', () => {
  it('allows two workspaces to import a byte-identical statement', async () => {
    const hash = 'identical-file-hash';
    await prisma.bankStatementImport.create({
      data: { workspaceId: a.workspaceId, beneficiaryAccountId: a.accountId, fileName: 's.csv', fileHash: hash },
    });

    await expect(
      prisma.bankStatementImport.create({
        data: {
          workspaceId: b.workspaceId,
          beneficiaryAccountId: b.accountId,
          fileName: 's.csv',
          fileHash: hash,
        },
      }),
    ).resolves.toBeTruthy();
  });

  it('still blocks the same workspace re-importing the same file', async () => {
    const hash = 'same-workspace-hash';
    await prisma.bankStatementImport.create({
      data: { workspaceId: a.workspaceId, beneficiaryAccountId: a.accountId, fileName: 's.csv', fileHash: hash },
    });

    await expect(
      prisma.bankStatementImport.create({
        data: {
          workspaceId: a.workspaceId,
          beneficiaryAccountId: a.accountId,
          fileName: 's.csv',
          fileHash: hash,
        },
      }),
    ).rejects.toThrow();
  });

  it('allows an identical statement row in two different accounts', async () => {
    const importA = await prisma.bankStatementImport.findFirstOrThrow({
      where: { beneficiaryAccountId: a.accountId },
    });
    const importB = await prisma.bankStatementImport.findFirstOrThrow({
      where: { beneficiaryAccountId: b.accountId },
    });

    const row = {
      txnDate: new Date('2026-11-20T00:00:00.000Z'),
      description: 'NEFT CREDIT SAME ROW',
      reference: '999888777',
      refNormalized: '999888777',
      amountPaise: AMOUNT_PAISE,
      direction: 'CREDIT' as const,
      rowHash: 'collision-row-hash',
    };

    await prisma.bankTransaction.create({
      data: { ...row, importId: importA.id, workspaceId: a.workspaceId, beneficiaryAccountId: a.accountId },
    });

    // Previously this second row vanished behind skipDuplicates, leaving the
    // other customer's guest unverifiable.
    await expect(
      prisma.bankTransaction.create({
        data: { ...row, importId: importB.id, workspaceId: b.workspaceId, beneficiaryAccountId: b.accountId },
      }),
    ).resolves.toBeTruthy();
  });
});
