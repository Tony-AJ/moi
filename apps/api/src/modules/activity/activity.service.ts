import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { WorkspaceScope } from '../workspaces/workspace-access.service';

/** Actions a guest triggers without signing in. */
const GUEST_ACTIONS = new Set(['ENTRY_CREATED', 'PAYMENT_REFERENCE_CLAIMED']);

export interface ActivityQuery {
  eventId?: string;
  /** ISO timestamp; returns rows strictly older, for "load more". */
  before?: string;
  limit?: number;
}

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The audit trail of one workspace, as its members may see it.
   *
   * Owners and workspace admins see every row in their workspace, including
   * workspace-level ones such as a payment account being added. Event staff
   * see only rows tied to an event they are assigned to; a row with no event
   * is never shown to them, so a missing assignment fails closed.
   */
  async list(scope: WorkspaceScope, query: ActivityQuery) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

    const where: Prisma.AuditLogWhereInput = { workspaceId: scope.workspaceId };
    if (query.eventId) {
      where.eventId = query.eventId;
    } else if (scope.eventIds !== null) {
      where.eventId = { in: scope.eventIds };
    }

    if (query.before) {
      const before = new Date(query.before);
      if (!Number.isNaN(before.getTime())) where.createdAt = { lt: before };
    }

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        eventId: true,
        isSupportAccess: true,
        metadata: true,
        createdAt: true,
        // Deliberately not the ip column: it identifies guests, and the
        // organizer does not need it to follow what happened.
        adminUser: { select: { name: true } },
        event: { select: { name: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    return {
      hasMore,
      nextBefore: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
      rows: page.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        eventId: row.eventId,
        eventName: row.event?.name ?? null,
        actor: row.adminUser
          ? { kind: row.isSupportAccess ? 'PLATFORM' : 'TEAM', name: row.adminUser.name }
          : { kind: GUEST_ACTIONS.has(row.action) ? 'GUEST' : 'SYSTEM', name: null },
        metadata: row.metadata,
        createdAt: row.createdAt,
      })),
    };
  }
}
