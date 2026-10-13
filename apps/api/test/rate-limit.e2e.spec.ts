/**
 * Rate limiting.
 *
 * The main lifecycle suite raises every limit so it can make hundreds of
 * calls, which means it cannot also prove the limits work. This file boots a
 * separate application with production-shaped limits instead.
 *
 * The env import must stay first: the @Throttle decorators read their limits
 * when their controller module is imported.
 */
import './helpers/strict-throttle-env';
import { E2EContext } from './helpers/e2e-app';

const ctx = new E2EContext();

beforeAll(async () => {
  await ctx.start();
}, 240_000);

afterAll(async () => {
  await ctx.stop();
});

describe('login rate limiting', () => {
  it('stops repeated failed logins rather than letting them run forever', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await ctx.post('/admin/auth/login', {
        email: 'bruteforce@test.local',
        password: 'wrong-but-long-enough',
      });
      statuses.push(response.status);
    }
    // Brute forcing a password has to hit a wall.
    expect(statuses).toContain(429);
    // And the wall comes after the configured number of tries, not before.
    expect(statuses.slice(0, 3).every((status) => status === 401)).toBe(true);
  });
});

describe('guest write rate limiting', () => {
  it('limits how fast one source can create entries', async () => {
    const workspace = await ctx.prisma.workspace.create({
      data: { slug: 'throttle-ws', name: 'Throttle workspace', status: 'ACTIVE' },
    });
    const account = await ctx.prisma.beneficiaryAccount.create({
      data: {
        workspaceId: workspace.id,
        label: 'Throttle account',
        upiId: 'throttle@okicici',
        payeeName: 'Throttle payee',
        status: 'CONFIRMED',
      },
    });
    const event = await ctx.prisma.event.create({
      data: {
        workspaceId: workspace.id,
        slug: 'throttle-event',
        name: 'Throttle event',
        eventDate: new Date('2026-11-21T10:00:00.000Z'),
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
      data: { activePaymentConfigId: config.id },
    });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await ctx.post('/events/throttle-event/entries', {
        guestName: 'Flood Guest ' + attempt,
        amountPaise: 100000,
      });
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
    // The entries that were accepted before the limit are still recorded.
    const recorded = await ctx.prisma.moiEntry.count({ where: { eventId: event.id } });
    expect(recorded).toBe(statuses.filter((status) => status === 201).length);
  });
});
