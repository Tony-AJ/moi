import { PrismaClient, type WorkspaceRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function token(length = 24): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function entryCode(n: number): string {
  return 'MOI-' + String(n).padStart(6, '0');
}

async function upsertUser(params: {
  email: string;
  name: string;
  password: string;
  platformRole?: 'USER' | 'SUPER_ADMIN';
  legacyRole?: 'OWNER' | 'STAFF';
}) {
  const email = params.email.toLowerCase();
  return prisma.adminUser.upsert({
    where: { email },
    update: {
      isActive: true,
      platformRole: params.platformRole ?? 'USER',
      role: params.legacyRole ?? 'STAFF',
    },
    create: {
      email,
      name: params.name,
      passwordHash: await bcrypt.hash(params.password, 12),
      platformRole: params.platformRole ?? 'USER',
      role: params.legacyRole ?? 'STAFF',
    },
  });
}

async function addMember(workspaceId: string, userId: string, role: WorkspaceRole) {
  return prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId } },
    update: { role, status: 'ACTIVE' },
    create: { workspaceId, userId, role, status: 'ACTIVE', acceptedAt: new Date() },
  });
}

/**
 * Creates a workspace with a confirmed beneficiary, one event, and the
 * version 1 payment config that pins that event to that beneficiary.
 * Each workspace gets its own UPI id, which is what makes the isolation
 * tests meaningful: a credit to one account must never verify the other
 * workspace's contribution.
 */
async function seedWorkspace(params: {
  slug: string;
  name: string;
  ownerEmail: string;
  ownerName: string;
  password: string;
  upiId: string;
  payeeName: string;
  event: {
    slug: string;
    name: string;
    hostName: string;
    eventDate: string;
    venue: string;
    suggestedAmounts: number[];
  };
}) {
  const workspace = await prisma.workspace.upsert({
    where: { slug: params.slug },
    update: { status: 'ACTIVE' },
    create: {
      slug: params.slug,
      name: params.name,
      status: 'ACTIVE',
      activatedAt: new Date(),
      contactEmail: params.ownerEmail,
    },
  });

  const owner = await upsertUser({
    email: params.ownerEmail,
    name: params.ownerName,
    password: params.password,
    legacyRole: 'OWNER',
  });
  await addMember(workspace.id, owner.id, 'WORKSPACE_OWNER');

  const beneficiary = await prisma.beneficiaryAccount.upsert({
    where: { workspaceId_upiId: { workspaceId: workspace.id, upiId: params.upiId } },
    update: { payeeName: params.payeeName },
    create: {
      workspaceId: workspace.id,
      label: 'Primary collection account',
      upiId: params.upiId,
      payeeName: params.payeeName,
      // Seeded as confirmed so the dev event is publishable. In the real
      // flow the owner has to confirm the details explicitly.
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      confirmedByUserId: owner.id,
    },
  });

  const event = await prisma.event.upsert({
    where: { slug: params.event.slug },
    update: { workspaceId: workspace.id },
    create: {
      workspaceId: workspace.id,
      slug: params.event.slug,
      name: params.event.name,
      hostName: params.event.hostName,
      eventDate: new Date(params.event.eventDate),
      venue: params.event.venue,
      suggestedAmounts: params.event.suggestedAmounts,
      collectPhone: true,
      requirePhone: false,
      // Legacy shadow columns, kept in sync until step C drops them.
      upiId: params.upiId,
      upiPayeeName: params.payeeName,
    },
  });

  const config = await prisma.eventPaymentConfig.upsert({
    where: { eventId_version: { eventId: event.id, version: 1 } },
    update: {},
    create: {
      eventId: event.id,
      beneficiaryAccountId: beneficiary.id,
      version: 1,
      upiIdSnapshot: params.upiId,
      payeeNameSnapshot: params.payeeName,
      createdByUserId: owner.id,
    },
  });

  await prisma.event.update({
    where: { id: event.id },
    data: { activePaymentConfigId: config.id },
  });

  return { workspace, owner, beneficiary, event, config };
}

async function main(): Promise<void> {
  // Platform operator. Separate from any customer owner on purpose: a
  // platform role is not a licence to read a family's guest list.
  const superAdmin = await upsertUser({
    email: process.env.SEED_SUPER_ADMIN_EMAIL ?? 'super@moiledger.local',
    name: 'Platform Super Admin',
    password: process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe#123',
    platformRole: 'SUPER_ADMIN',
  });
  console.log('Super admin ready: ' + superAdmin.email);

  // --- Workspace A ---------------------------------------------------------
  const a = await seedWorkspace({
    slug: 'kumar-family',
    name: 'Kumar Family',
    ownerEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@moiledger.local',
    ownerName: process.env.SEED_ADMIN_NAME ?? 'Event Organizer',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe#123',
    upiId: process.env.DEFAULT_UPI_ID ?? 'kumar.family@okicici',
    payeeName: process.env.DEFAULT_UPI_PAYEE_NAME ?? 'Kumar Family',
    event: {
      slug: 'kumar-wedding-2026',
      name: 'Kumar & Priya Wedding Reception',
      hostName: 'Kumar Family',
      eventDate: '2026-11-21T10:00:00.000Z',
      venue: 'Sri Krishna Mahal, Coimbatore',
      suggestedAmounts: [50000, 100000, 200000, 500000],
    },
  });
  await prisma.workspace.update({
    where: { id: a.workspace.id },
    data: { createdByUserId: superAdmin.id },
  });

  // Event staff scoped to workspace A's event only.
  const staff = await upsertUser({
    email: 'staff@moiledger.local',
    name: 'Registration Desk',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe#123',
    legacyRole: 'STAFF',
  });
  await addMember(a.workspace.id, staff.id, 'EVENT_STAFF');
  await prisma.eventMember.upsert({
    where: { eventId_userId: { eventId: a.event.id, userId: staff.id } },
    update: {},
    create: {
      eventId: a.event.id,
      userId: staff.id,
      canRecordEntries: true,
      canUploadStatements: true,
      canResolveReviews: false,
      canExportReports: false,
      assignedByUserId: a.owner.id,
    },
  });

  // --- Workspace B ---------------------------------------------------------
  // A second, unrelated customer. Nothing here may ever be reachable from
  // workspace A's credentials; this pair is the fixture for the cross-tenant
  // isolation tests.
  const b = await seedWorkspace({
    slug: 'raman-family',
    name: 'Raman Family',
    ownerEmail: 'priya@moiledger.local',
    ownerName: 'Priya Raman',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe#123',
    upiId: 'raman.family@okaxis',
    payeeName: 'Raman Family',
    event: {
      slug: 'raman-grihapravesam-2026',
      name: 'Raman Grihapravesam',
      hostName: 'Raman Family',
      eventDate: '2026-12-05T04:30:00.000Z',
      venue: 'Anna Nagar, Chennai',
      suggestedAmounts: [25000, 50000, 100000],
    },
  });
  await prisma.workspace.update({
    where: { id: b.workspace.id },
    data: { createdByUserId: superAdmin.id },
  });

  console.log('Workspace A: ' + a.workspace.slug + ' / event ' + a.event.slug);
  console.log('Workspace B: ' + b.workspace.slug + ' / event ' + b.event.slug);

  // --- Demo entries for workspace A ---------------------------------------
  const existing = await prisma.moiEntry.count({ where: { eventId: a.event.id } });
  if (existing > 0) {
    console.log('Event already has ' + existing + ' entries; skipping demo entries.');
    return;
  }

  const demo = [
    { guestName: 'Arun Kumar', guestAddress: 'Coimbatore', amountPaise: 100000, method: 'UPI' as const, utr: '412345678901' },
    { guestName: 'Lakshmi Devi', guestAddress: 'Tiruppur', amountPaise: 250000, method: 'UPI' as const, utr: '412345678902' },
    { guestName: 'Suresh Babu', guestAddress: 'Erode', amountPaise: 50000, method: 'UPI' as const, utr: null },
    { guestName: 'Meena Rajan', guestAddress: 'Salem', amountPaise: 500000, method: 'CASH' as const, utr: null },
    { guestName: 'Ravi Shankar', guestAddress: 'Chennai', amountPaise: 100000, method: 'UPI' as const, utr: '412345678905' },
  ];

  let n = 0;
  for (const row of demo) {
    n += 1;
    const entry = await prisma.moiEntry.create({
      data: {
        eventId: a.event.id,
        // Cash takes no UPI beneficiary, so it pins no payment config.
        paymentConfigId: row.method === 'CASH' ? null : a.config.id,
        entryNumber: n,
        entryCode: entryCode(n),
        guestName: row.guestName,
        guestAddress: row.guestAddress,
        amountPaise: row.amountPaise,
        paymentMethod: row.method,
        paymentStatus: 'AWAITING_VERIFICATION',
        accessToken: token(),
      },
    });

    if (row.utr) {
      await prisma.paymentClaim.create({
        data: {
          entryId: entry.id,
          utr: row.utr,
          utrNormalized: row.utr,
          source: 'GUEST',
          status: 'CLAIMED',
        },
      });
    }

    console.log('  ' + entry.entryCode + '  ' + row.guestName + '  token=' + entry.accessToken);
  }

  await prisma.event.update({
    where: { id: a.event.id },
    data: { entrySequence: n },
  });

  console.log('\nSeed complete.');
  console.log('Owner A login:  ' + a.owner.email);
  console.log('Owner B login:  ' + b.owner.email);
  console.log('Staff login:    ' + staff.email + '  (workspace A event only)');
  console.log('Super admin:    ' + superAdmin.email);
  console.log('Guest pages:    /e/' + a.event.slug + '   /e/' + b.event.slug);
  console.log('Sample statement: apps/api/prisma/sample-bank-statement.csv');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
