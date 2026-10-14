import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdminEventsService } from '../admin-events/admin-events.service';
import type { AdminPrincipal } from '../../common/decorators/current-admin.decorator';
import { generateTemporaryPassword } from '../../common/utils/password.util';
import { slugify } from '../../common/utils/token.util';
import {
  AddWorkspaceEventDto,
  ProvisionOrganizerDto,
  UpdatePlatformUserDto,
  UpdateWorkspaceStatusDto,
} from './dto/platform.dto';

/** Same defaults an organizer gets when they create an event themselves. */
const DEFAULT_SUGGESTED_AMOUNTS = [50000, 100000, 200000, 500000];

/**
 * What a platform operator does: provision organizers, issue and reset their
 * logins, and suspend or restore access.
 *
 * What it deliberately does not do is read a customer's register. Nothing
 * here returns guest names, amounts or totals; the overview carries counts
 * and statuses only. Seeing an event's money still requires a membership in
 * its workspace, exactly as before.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: AdminEventsService,
  ) {}

  async overview() {
    const workspaces = await this.prisma.workspace.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        contactEmail: true,
        contactPhone: true,
        suspendedAt: true,
        suspendedReason: true,
        createdAt: true,
        members: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          select: {
            role: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                isActive: true,
                platformRole: true,
                mustChangePassword: true,
                lastLoginAt: true,
              },
            },
          },
        },
        events: {
          orderBy: { eventDate: 'desc' },
          select: {
            id: true,
            name: true,
            slug: true,
            eventDate: true,
            venue: true,
            isOpen: true,
            activePaymentConfigId: true,
            createdAt: true,
            _count: { select: { entries: true } },
          },
        },
      },
    });

    const eventIds = workspaces.flatMap((workspace) => workspace.events.map((event) => event.id));
    const lastActivity = eventIds.length
      ? await this.prisma.auditLog.groupBy({
          by: ['eventId'],
          where: { eventId: { in: eventIds } },
          _max: { createdAt: true },
        })
      : [];
    const lastActivityByEvent = new Map(
      lastActivity.map((row) => [row.eventId, row._max.createdAt]),
    );

    return workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      status: workspace.status,
      contactEmail: workspace.contactEmail,
      contactPhone: workspace.contactPhone,
      suspendedAt: workspace.suspendedAt,
      suspendedReason: workspace.suspendedReason,
      createdAt: workspace.createdAt,
      members: workspace.members.map((member) => ({ role: member.role, ...member.user })),
      events: workspace.events.map((event) => ({
        id: event.id,
        name: event.name,
        slug: event.slug,
        eventDate: event.eventDate,
        venue: event.venue,
        isOpen: event.isOpen,
        guestUrl: this.events.guestUrl(event.slug),
        // The organizer has to add and confirm their own UPI account. Until
        // then the event can record cash but cannot take UPI payments.
        paymentReady: Boolean(event.activePaymentConfigId),
        entryCount: event._count.entries,
        lastActivityAt: lastActivityByEvent.get(event.id) ?? null,
        createdAt: event.createdAt,
      })),
    }));
  }

  async provisionOrganizer(dto: ProvisionOrganizerDto, actor: AdminPrincipal, ip?: string) {
    const existing = await this.prisma.adminUser.findUnique({
      where: { email: dto.organizerEmail },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        "An account with this email already exists. To give that organizer another event, use 'Add event' on their workspace.",
      );
    }

    const workspaceName = dto.workspaceName || dto.hostName || dto.organizerName;
    const [workspaceSlug, eventSlug] = await Promise.all([
      this.uniqueWorkspaceSlug(workspaceName),
      this.events.uniqueSlug(dto.eventName),
    ]);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const now = new Date();

    // One transaction: a half-provisioned organizer (a user with no
    // workspace, or a workspace with no owner) would block the retry with
    // "email already exists" and need a manual cleanup.
    const created = await this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          slug: workspaceSlug,
          name: workspaceName,
          status: 'ACTIVE',
          activatedAt: now,
          contactEmail: dto.organizerEmail,
          contactPhone: dto.organizerPhone ?? null,
          createdByUserId: actor.id,
        },
      });

      const organizer = await tx.adminUser.create({
        data: {
          email: dto.organizerEmail,
          name: dto.organizerName,
          passwordHash,
          platformRole: 'USER',
          // Legacy flat role, still read by a few pre-tenant code paths.
          role: 'OWNER',
          mustChangePassword: true,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: organizer.id,
          role: 'WORKSPACE_OWNER',
          status: 'ACTIVE',
          invitedByUserId: actor.id,
          acceptedAt: now,
        },
      });

      const event = await tx.event.create({
        data: {
          workspaceId: workspace.id,
          slug: eventSlug,
          name: dto.eventName,
          hostName: dto.hostName || null,
          eventDate: new Date(dto.eventDate),
          venue: dto.venue || null,
          suggestedAmounts: DEFAULT_SUGGESTED_AMOUNTS,
        },
      });

      return { workspace, organizer, event };
    });

    await this.audit.record({
      adminUserId: actor.id,
      workspaceId: created.workspace.id,
      isSupportAccess: true,
      action: 'PLATFORM_ORGANIZER_PROVISIONED',
      entityType: 'Workspace',
      entityId: created.workspace.id,
      ip,
      // Never the password: it exists only in this response.
      metadata: {
        organizerUserId: created.organizer.id,
        organizerEmail: created.organizer.email,
        eventId: created.event.id,
      },
    });
    await this.audit.record({
      adminUserId: actor.id,
      isSupportAccess: true,
      action: 'EVENT_CREATED',
      entityType: 'Event',
      entityId: created.event.id,
      ip,
      metadata: { slug: created.event.slug, name: created.event.name, byPlatform: true },
    });

    return {
      workspace: {
        id: created.workspace.id,
        name: created.workspace.name,
        slug: created.workspace.slug,
      },
      event: {
        id: created.event.id,
        name: created.event.name,
        slug: created.event.slug,
        eventDate: created.event.eventDate,
        guestUrl: this.events.guestUrl(created.event.slug),
      },
      organizer: {
        id: created.organizer.id,
        name: created.organizer.name,
        email: created.organizer.email,
      },
      temporaryPassword,
    };
  }

  async addEvent(
    workspaceId: string,
    dto: AddWorkspaceEventDto,
    actor: AdminPrincipal,
    ip?: string,
  ) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const event = await this.prisma.event.create({
      data: {
        workspaceId,
        slug: await this.events.uniqueSlug(dto.eventName),
        name: dto.eventName,
        hostName: dto.hostName || null,
        eventDate: new Date(dto.eventDate),
        venue: dto.venue || null,
        suggestedAmounts: DEFAULT_SUGGESTED_AMOUNTS,
      },
    });

    await this.audit.record({
      adminUserId: actor.id,
      isSupportAccess: true,
      action: 'EVENT_CREATED',
      entityType: 'Event',
      entityId: event.id,
      ip,
      metadata: { slug: event.slug, name: event.name, byPlatform: true },
    });

    return {
      id: event.id,
      name: event.name,
      slug: event.slug,
      eventDate: event.eventDate,
      guestUrl: this.events.guestUrl(event.slug),
    };
  }

  async resetPassword(userId: string, actor: AdminPrincipal, ip?: string) {
    const target = await this.manageableUser(userId, actor);

    const temporaryPassword = generateTemporaryPassword();
    await this.prisma.adminUser.update({
      where: { id: target.id },
      data: {
        passwordHash: await bcrypt.hash(temporaryPassword, 12),
        mustChangePassword: true,
      },
    });

    await this.audit.record({
      adminUserId: actor.id,
      workspaceId: target.primaryWorkspaceId,
      isSupportAccess: true,
      action: 'PLATFORM_PASSWORD_RESET',
      entityType: 'AdminUser',
      entityId: target.id,
      ip,
      metadata: { email: target.email },
    });

    return {
      user: { id: target.id, name: target.name, email: target.email },
      temporaryPassword,
    };
  }

  async updateUser(
    userId: string,
    dto: UpdatePlatformUserDto,
    actor: AdminPrincipal,
    ip?: string,
  ) {
    const target = await this.manageableUser(userId, actor);

    const user = await this.prisma.adminUser.update({
      where: { id: target.id },
      data: { isActive: dto.isActive },
      select: { id: true, name: true, email: true, isActive: true },
    });

    await this.audit.record({
      adminUserId: actor.id,
      workspaceId: target.primaryWorkspaceId,
      isSupportAccess: true,
      action: dto.isActive ? 'PLATFORM_USER_ACTIVATED' : 'PLATFORM_USER_DEACTIVATED',
      entityType: 'AdminUser',
      entityId: target.id,
      ip,
      metadata: { email: target.email },
    });

    return user;
  }

  async updateWorkspaceStatus(
    workspaceId: string,
    dto: UpdateWorkspaceStatusDto,
    actor: AdminPrincipal,
    ip?: string,
  ) {
    const existing = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('Workspace not found');

    const suspending = dto.status === 'SUSPENDED';
    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: suspending
        ? { status: 'SUSPENDED', suspendedAt: new Date(), suspendedReason: dto.reason ?? null }
        : {
            status: 'ACTIVE',
            suspendedAt: null,
            suspendedReason: null,
            activatedAt: existing.status === 'PENDING' ? new Date() : undefined,
          },
      select: { id: true, name: true, status: true, suspendedAt: true, suspendedReason: true },
    });

    await this.audit.record({
      adminUserId: actor.id,
      workspaceId,
      isSupportAccess: true,
      action: suspending ? 'PLATFORM_WORKSPACE_SUSPENDED' : 'PLATFORM_WORKSPACE_RESTORED',
      entityType: 'Workspace',
      entityId: workspaceId,
      ip,
      metadata: { from: existing.status, to: workspace.status, reason: dto.reason ?? null },
    });

    return workspace;
  }

  /**
   * A platform operator may manage organizer logins, but not other platform
   * operators and not themselves: a stolen operator session must not be able
   * to take over or lock out the remaining operators.
   */
  private async manageableUser(userId: string, actor: AdminPrincipal) {
    if (userId === actor.id) {
      throw new BadRequestException('Use "Change password" for your own account');
    }

    const target = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        platformRole: true,
        memberships: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { workspaceId: true },
        },
      },
    });
    if (!target) throw new NotFoundException('User not found');
    if (target.platformRole === 'SUPER_ADMIN') {
      throw new ForbiddenException('Platform administrator accounts cannot be managed here');
    }

    return {
      id: target.id,
      name: target.name,
      email: target.email,
      primaryWorkspaceId: target.memberships[0]?.workspaceId ?? null,
    };
  }

  private async uniqueWorkspaceSlug(name: string): Promise<string> {
    const base = slugify(name) || 'workspace';
    let candidate = base;
    let suffix = 1;
    while (await this.prisma.workspace.findUnique({ where: { slug: candidate } })) {
      suffix += 1;
      candidate = base + '-' + suffix;
    }
    return candidate;
  }
}
