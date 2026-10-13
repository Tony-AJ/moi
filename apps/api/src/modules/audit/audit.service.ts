import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditInput {
  adminUserId?: string | null;
  /** Workspace the action touched; null for platform-level actions. */
  workspaceId?: string | null;
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
      await this.prisma.auditLog.create({
        data: {
          adminUserId: input.adminUserId ?? null,
          workspaceId: input.workspaceId ?? null,
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
}
