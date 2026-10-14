import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateEventDto, UpdateEventDto } from './dto/event.dto';
import { slugify } from '../../common/utils/token.util';
import type { WorkspaceScope } from '../workspaces/workspace-access.service';

@Injectable()
export class AdminEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async list(scope: WorkspaceScope) {
    // Staff see only the events they are assigned to; owners and workspace
    // admins see every event in their own workspace and nothing beyond it.
    const where =
      scope.eventIds !== null
        ? { id: { in: scope.eventIds } }
        : { workspaceId: scope.workspaceId };

    const events = await this.prisma.event.findMany({
      where,
      orderBy: { eventDate: 'desc' },
    });

    // The totals must be aggregated over the same event set, otherwise a
    // dashboard figure could include another customer's contributions.
    const grouped = await this.prisma.moiEntry.groupBy({
      by: ['eventId', 'paymentStatus'],
      where: { eventId: { in: events.map((event) => event.id) } },
      _count: { _all: true },
      _sum: { amountPaise: true },
    });

    return events.map((event) => {
      const rows = grouped.filter((row) => row.eventId === event.id);
      const sumFor = (status: string) =>
        rows.find((r) => r.paymentStatus === status)?._sum.amountPaise ?? 0;
      const countFor = (status: string) =>
        rows.find((r) => r.paymentStatus === status)?._count._all ?? 0;

      return {
        ...event,
        guestUrl: this.guestUrl(event.slug),
        totals: {
          entries: rows.reduce((acc, r) => acc + r._count._all, 0),
          submittedPaise: rows.reduce((acc, r) => acc + (r._sum.amountPaise ?? 0), 0),
          verifiedPaise: sumFor('VERIFIED'),
          verifiedCount: countFor('VERIFIED'),
          awaitingCount: countFor('AWAITING_VERIFICATION'),
          reviewCount: countFor('REVIEW_REQUIRED'),
          notFoundCount: countFor('NOT_FOUND'),
        },
      };
    });
  }

  async get(id: string, scope: WorkspaceScope) {
    const event = await this.prisma.event.findFirst({
      where: { id, workspaceId: scope.workspaceId },
    });
    if (!event) throw new NotFoundException('Event not found');
    return { ...event, guestUrl: this.guestUrl(event.slug) };
  }

  async create(dto: CreateEventDto, adminId: string, scope: WorkspaceScope) {
    const slug = dto.slug ?? (await this.uniqueSlug(dto.name));
    const minAmountPaise = dto.minAmountPaise ?? 100;
    const maxAmountPaise = dto.maxAmountPaise ?? 10_000_000;
    if (minAmountPaise > maxAmountPaise) {
      throw new BadRequestException('Minimum amount cannot exceed the maximum amount');
    }

    const exists = await this.prisma.event.findUnique({ where: { slug } });
    if (exists) throw new ConflictException('An event with that slug already exists');

    const event = await this.prisma.event.create({
      data: {
        workspaceId: scope.workspaceId,
        slug,
        name: dto.name,
        hostName: dto.hostName || null,
        eventDate: new Date(dto.eventDate),
        venue: dto.venue || null,
        upiId: dto.upiId || null,
        upiPayeeName: dto.upiPayeeName || null,
        suggestedAmounts: dto.suggestedAmounts ?? [50000, 100000, 200000, 500000],
        minAmountPaise,
        maxAmountPaise,
        collectPhone: dto.collectPhone ?? false,
        requirePhone: dto.requirePhone ?? false,
      },
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'EVENT_CREATED',
      entityType: 'Event',
      entityId: event.id,
      workspaceId: scope.workspaceId,
      metadata: { slug: event.slug, name: event.name },
    });

    return { ...event, guestUrl: this.guestUrl(event.slug) };
  }

  async update(id: string, dto: UpdateEventDto, adminId: string, scope: WorkspaceScope) {
    // Scoped read, so an id belonging to another workspace is a 404 here
    // rather than an update.
    const existing = await this.prisma.event.findFirst({
      where: { id, workspaceId: scope.workspaceId },
    });
    if (!existing) throw new NotFoundException('Event not found');

    const min = dto.minAmountPaise ?? existing.minAmountPaise;
    const max = dto.maxAmountPaise ?? existing.maxAmountPaise;
    if (min > max) throw new BadRequestException('Minimum amount cannot exceed the maximum amount');

    const event = await this.prisma.event.update({
      where: { id },
      data: {
        name: dto.name,
        hostName: dto.hostName,
        eventDate: dto.eventDate ? new Date(dto.eventDate) : undefined,
        venue: dto.venue,
        upiId: dto.upiId,
        upiPayeeName: dto.upiPayeeName,
        suggestedAmounts: dto.suggestedAmounts,
        minAmountPaise: dto.minAmountPaise,
        maxAmountPaise: dto.maxAmountPaise,
        collectPhone: dto.collectPhone,
        requirePhone: dto.requirePhone,
        isOpen: dto.isOpen,
      },
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'EVENT_UPDATED',
      entityType: 'Event',
      entityId: id,
      workspaceId: scope.workspaceId,
      metadata: { ...dto },
    });

    return { ...event, guestUrl: this.guestUrl(event.slug) };
  }

  /**
   * The QR code is generated client side from this URL, so the admin can
   * print it without the API needing an image pipeline.
   */
  guestUrl(slug: string): string {
    const base = (this.config.get<string>('GUEST_WEB_URL') ?? 'http://localhost:5173').replace(
      /\/+$/,
      '',
    );
    return base + '/e/' + slug;
  }

  async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'event';
    let candidate = base;
    let suffix = 1;
    // Small loop; event creation is rare and slugs are short.
    while (await this.prisma.event.findUnique({ where: { slug: candidate } })) {
      suffix += 1;
      candidate = base + '-' + suffix;
    }
    return candidate;
  }
}
