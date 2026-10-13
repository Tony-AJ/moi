import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminPrincipal } from '../../common/decorators/current-admin.decorator';

/** Event-level capabilities an EVENT_STAFF member may be granted. */
export type EventPermission =
  | 'canRecordEntries'
  | 'canUploadStatements'
  | 'canResolveReviews'
  | 'canExportReports';

export interface WorkspaceScope {
  workspaceId: string;
  role: WorkspaceRole;
  /**
   * Event ids the caller may touch, or null when they may touch every event
   * in the workspace (owners and workspace admins).
   */
  eventIds: string[] | null;
}

/**
 * Resolves what a caller is actually allowed to reach.
 *
 * The whole point of this service is that no caller-supplied identifier is
 * ever trusted on its own. A workspace id, event id or account id arriving
 * from the browser is treated as a request, and is only honoured after it has
 * been checked against the membership rows for that user. Every protected
 * read and write goes through one of these methods.
 */
@Injectable()
export class WorkspaceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The workspace the caller is operating in. When they belong to several,
   * the requested id must be one of them; a caller who sends nothing and
   * belongs to exactly one workspace gets that one.
   */
  async resolveScope(
    principal: AdminPrincipal,
    requestedWorkspaceId?: string,
  ): Promise<WorkspaceScope> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: {
        userId: principal.id,
        status: 'ACTIVE',
        // A suspended workspace is readable by nobody until it is restored.
        workspace: { status: 'ACTIVE' },
      },
      select: { workspaceId: true, role: true },
    });

    if (memberships.length === 0) {
      throw new ForbiddenException('You do not have access to any active workspace');
    }

    const membership = requestedWorkspaceId
      ? memberships.find((m) => m.workspaceId === requestedWorkspaceId)
      : memberships.length === 1
        ? memberships[0]
        : undefined;

    if (!membership) {
      // Deliberately the same message whether the workspace does not exist
      // or the caller simply has no membership in it, so the API cannot be
      // used to probe which workspaces exist.
      throw new ForbiddenException('You do not have access to that workspace');
    }

    if (membership.role === 'EVENT_STAFF') {
      const assignments = await this.prisma.eventMember.findMany({
        where: { userId: principal.id, event: { workspaceId: membership.workspaceId } },
        select: { eventId: true },
      });
      return {
        workspaceId: membership.workspaceId,
        role: membership.role,
        eventIds: assignments.map((a) => a.eventId),
      };
    }

    return { workspaceId: membership.workspaceId, role: membership.role, eventIds: null };
  }

  /** Throws unless the caller may act on this event. */
  async assertEventAccess(
    principal: AdminPrincipal,
    eventId: string,
    permission?: EventPermission,
  ): Promise<WorkspaceScope> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, workspaceId: true },
    });
    if (!event?.workspaceId) throw new NotFoundException('Event not found');

    const scope = await this.resolveScope(principal, event.workspaceId);

    if (scope.eventIds !== null) {
      if (!scope.eventIds.includes(eventId)) {
        throw new ForbiddenException('You are not assigned to that event');
      }
      if (permission) {
        const assignment = await this.prisma.eventMember.findUnique({
          where: { eventId_userId: { eventId, userId: principal.id } },
        });
        if (!assignment?.[permission]) {
          throw new ForbiddenException('Your event permissions do not allow that action');
        }
      }
    }

    return scope;
  }

  /** Throws unless the caller may use this beneficiary account. */
  async assertAccountAccess(
    principal: AdminPrincipal,
    beneficiaryAccountId: string,
  ): Promise<WorkspaceScope> {
    const account = await this.prisma.beneficiaryAccount.findUnique({
      where: { id: beneficiaryAccountId },
      select: { workspaceId: true },
    });
    if (!account) throw new NotFoundException('Payment account not found');
    return this.resolveScope(principal, account.workspaceId);
  }

  /** Throws unless the caller may act on this entry. */
  async assertEntryAccess(
    principal: AdminPrincipal,
    entryId: string,
    permission?: EventPermission,
  ): Promise<WorkspaceScope> {
    const entry = await this.prisma.moiEntry.findUnique({
      where: { id: entryId },
      select: { eventId: true },
    });
    if (!entry) throw new NotFoundException('Entry not found');
    return this.assertEventAccess(principal, entry.eventId, permission);
  }

  /**
   * Turns a scope into the event filter every list query must apply. Staff
   * with no assignments get an impossible filter rather than an open one, so
   * a missing grant fails closed.
   */
  eventFilter(scope: WorkspaceScope, requestedEventId?: string) {
    if (requestedEventId) {
      if (scope.eventIds !== null && !scope.eventIds.includes(requestedEventId)) {
        throw new ForbiddenException('You are not assigned to that event');
      }
      // The workspace constraint is kept even when a specific event was
      // asked for. An owner's eventIds is null, meaning "every event in my
      // workspace", so checking the id against that list alone would let a
      // requested id from another workspace through untouched.
      return {
        eventId: requestedEventId,
        event: { workspaceId: scope.workspaceId },
      };
    }
    if (scope.eventIds !== null) {
      return {
        eventId: { in: scope.eventIds },
        event: { workspaceId: scope.workspaceId },
      };
    }
    return { event: { workspaceId: scope.workspaceId } };
  }

  /** True when the caller holds a platform role, for audit marking. */
  isPlatformOperator(principal: AdminPrincipal): boolean {
    return principal.platformRole === 'SUPER_ADMIN';
  }
}
