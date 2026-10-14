import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditInput {
  adminUserId?: string | null;
  /**
   * Workspace the action touched; null for platform-level actions. Derived
   * from the event when left out, see deriveScope.
   */
  workspaceId?: string | null;
  /**
   * Event the action concerned. Usually left out: it is derived from an
   * Event or MoiEntry entity, so callers only pass it for other entity types
   * (a statement import, for example) that still belong to one event.
   */
  eventId?: string | null;
  /**
   * Set when a platform operator reached into a customer workspace. This is
   * what makes a platform-wide role auditable instead of silent.
   */
  isSupportAccess?: boolean;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Audit writes must never break the business operation that triggered them. */
  async record(input: AuditInput): Promise<void> {
    try {
      const scope = await this.deriveScope(input);
      await this.prisma.auditLog.create({
        data: {
          adminUserId: input.adminUserId ?? null,
          workspaceId: scope.workspaceId,
          eventId: scope.eventId,
          isSupportAccess: input.isSupportAccess ?? false,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          metadata: input.metadata,
          ip: input.ip ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to write audit log ${input.action}: ${String(error)}`);
    }
  }

  /**
   * Every caller already names the entity it touched, so the event and its
   * workspace are worked out here instead of trusting each call site to pass
   * them. Several entry and reconciliation actions never did, which left
   * those rows invisible to a workspace-scoped activity feed.
   *
   * Values a caller passes explicitly always win.
   */
  private async deriveScope(
    input: AuditInput,
  ): Promise<{ eventId: string | null; workspaceId: string | null }> {
    let eventId = input.eventId ?? null;

    if (!eventId && input.entityId) {
      if (input.entityType === 'Event') {
        eventId = input.entityId;
      } else if (input.entityType === 'MoiEntry') {
        const entry = await this.prisma.moiEntry.findUnique({
          where: { id: input.entityId },
          select: { eventId: true },
        });
        eventId = entry?.eventId ?? null;
      }
    }

    if (!eventId) {
      return { eventId: null, workspaceId: input.workspaceId ?? null };
    }

    // Confirms the event exists (the column is a foreign key) and supplies
    // the owning workspace in the same read.
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, workspaceId: true },
    });

    return {
      eventId: event?.id ?? null,
      workspaceId: input.workspaceId ?? event?.workspaceId ?? null,
    };
  }
}
