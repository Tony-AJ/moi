import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditInput {
  adminUserId?: string | null;
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
