import { PrismaClient } from '@prisma/client';
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

async function main(): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@moiledger.local').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe#123';

  const admin = await prisma.adminUser.upsert({
    where: { email },
    update: { role: 'OWNER', isActive: true },
    create: {
      email,
      name: process.env.SEED_ADMIN_NAME ?? 'Event Organizer',
      passwordHash: await bcrypt.hash(password, 12),
      role: 'OWNER',
    },
  });
  console.log('Admin ready: ' + admin.email);

  const event = await prisma.event.upsert({
    where: { slug: 'kumar-wedding-2026' },
    update: {},
    create: {
      slug: 'kumar-wedding-2026',
      name: 'Kumar & Priya Wedding Reception',
      hostName: 'Kumar Family',
      eventDate: new Date('2026-11-21T10:00:00.000Z'),
      venue: 'Sri Krishna Mahal, Coimbatore',
      upiId: process.env.DEFAULT_UPI_ID ?? 'yourname@okicici',
      upiPayeeName: process.env.DEFAULT_UPI_PAYEE_NAME ?? 'Kumar Family',
      suggestedAmounts: [50000, 100000, 200000, 500000],
      collectPhone: true,
      requirePhone: false,
    },
  });
  console.log('Event ready: ' + event.slug);

  const existing = await prisma.moiEntry.count({ where: { eventId: event.id } });
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
        eventId: event.id,
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
    where: { id: event.id },
    data: { entrySequence: n },
  });

  console.log('\nSeed complete.');
  console.log('Login: ' + email + ' / ' + password);
  console.log('Guest page: /e/' + event.slug);
  console.log('Sample statement: apps/api/prisma/sample-bank-statement.csv');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
