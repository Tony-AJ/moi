import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { isValidVpa } from '../../common/utils/upi.util';
import type { WorkspaceScope } from '../workspaces/workspace-access.service';
import { CreateBeneficiaryDto, SelectBeneficiaryDto } from './dto/beneficiary.dto';

@Injectable()
export class BeneficiariesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(scope: WorkspaceScope) {
    return this.prisma.beneficiaryAccount.findMany({
      where: { workspaceId: scope.workspaceId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        label: true,
        upiId: true,
        payeeName: true,
        bankName: true,
        accountLast4: true,
        status: true,
        confirmedAt: true,
        createdAt: true,
        _count: { select: { paymentConfigs: true, statementImports: true } },
      },
    });
  }

  async create(dto: CreateBeneficiaryDto, scope: WorkspaceScope, actorId: string, ip?: string) {
    if (!isValidVpa(dto.upiId)) {
      throw new BadRequestException('That does not look like a valid UPI id');
    }

    const existing = await this.prisma.beneficiaryAccount.findUnique({
      where: { workspaceId_upiId: { workspaceId: scope.workspaceId, upiId: dto.upiId } },
    });
    if (existing) {
      throw new ConflictException('That UPI id is already configured in this workspace');
    }

    const account = await this.prisma.beneficiaryAccount.create({
      data: {
        workspaceId: scope.workspaceId,
        label: dto.label,
        upiId: dto.upiId,
        payeeName: dto.payeeName,
        bankName: dto.bankName || null,
        // Only the last four digits are ever stored, and only to help an
        // operator tell which account an uploaded statement came from.
        accountLast4: dto.accountLast4 ? dto.accountLast4.slice(-4) : null,
        // A configured UPI id is not proof of ownership, so a new account
        // starts unconfirmed and cannot be attached to an event yet.
        status: 'UNCONFIRMED',
      },
    });

    await this.audit.record({
      adminUserId: actorId,
      workspaceId: scope.workspaceId,
      action: 'BENEFICIARY_CREATED',
      entityType: 'BeneficiaryAccount',
      entityId: account.id,
      ip,
      metadata: { upiId: account.upiId, payeeName: account.payeeName },
    });

    return account;
  }

  /**
   * The owner attesting that the details are theirs. This is the only
   * ownership evidence in the first release; the proof that money actually
   * arrived comes later, from statement reconciliation.
   */
  async confirm(id: string, scope: WorkspaceScope, actorId: string, ip?: string) {
    if (scope.role !== 'WORKSPACE_OWNER') {
      throw new ForbiddenException('Only the workspace owner can confirm a payment account');
    }

    const account = await this.prisma.beneficiaryAccount.findFirst({
      where: { id, workspaceId: scope.workspaceId },
    });
    if (!account) throw new NotFoundException('Payment account not found');

    const updated = await this.prisma.beneficiaryAccount.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedByUserId: actorId },
    });

    await this.audit.record({
      adminUserId: actorId,
      workspaceId: scope.workspaceId,
      action: 'BENEFICIARY_CONFIRMED',
      entityType: 'BeneficiaryAccount',
      entityId: id,
      ip,
      metadata: { upiId: account.upiId },
    });

    return updated;
  }

  /**
   * Points an event at a beneficiary by creating a new configuration
   * version. Earlier versions are retained and the entries pinned to them
   * keep their original payee, so changing the account never rewrites where
   * past contributions were sent.
   */
  async selectForEvent(
    eventId: string,
    dto: SelectBeneficiaryDto,
    scope: WorkspaceScope,
    actorId: string,
    ip?: string,
  ) {
    if (scope.role === 'EVENT_STAFF') {
      throw new ForbiddenException('Only a workspace owner or admin can change the payee');
    }

    const [event, account] = await Promise.all([
      this.prisma.event.findFirst({
        where: { id: eventId, workspaceId: scope.workspaceId },
        include: { activePaymentConfig: true },
      }),
      this.prisma.beneficiaryAccount.findFirst({
        where: { id: dto.beneficiaryAccountId, workspaceId: scope.workspaceId },
      }),
    ]);

    if (!event) throw new NotFoundException('Event not found');
    if (!account) throw new NotFoundException('Payment account not found');
    if (account.status !== 'CONFIRMED') {
      throw new BadRequestException(
        'Confirm the payment account details before using it to collect contributions',
      );
    }

    if (event.activePaymentConfig?.beneficiaryAccountId === account.id) {
      return event.activePaymentConfig;
    }

    const config = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.eventPaymentConfig.findFirst({
        where: { eventId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });

      const created = await tx.eventPaymentConfig.create({
        data: {
          eventId,
          beneficiaryAccountId: account.id,
          version: (latest?.version ?? 0) + 1,
          // Frozen copies. The account could be renamed later; this entry's
          // history must not change with it.
          upiIdSnapshot: account.upiId,
          payeeNameSnapshot: account.payeeName,
          createdByUserId: actorId,
        },
      });

      // Close the previous version rather than deleting it.
      if (event.activePaymentConfig) {
        await tx.eventPaymentConfig.update({
          where: { id: event.activePaymentConfig.id },
          data: { effectiveTo: new Date() },
        });
      }

      await tx.event.update({
        where: { id: eventId },
        data: {
          activePaymentConfigId: created.id,
          // Legacy shadow columns, kept in step with the active config until
          // they are dropped.
          upiId: account.upiId,
          upiPayeeName: account.payeeName,
        },
      });

      return created;
    });

    await this.audit.record({
      adminUserId: actorId,
      workspaceId: scope.workspaceId,
      action: 'EVENT_BENEFICIARY_SELECTED',
      entityType: 'Event',
      entityId: eventId,
      ip,
      metadata: {
        beneficiaryAccountId: account.id,
        upiId: account.upiId,
        version: config.version,
        previousVersion: event.activePaymentConfig?.version ?? null,
      },
    });

    return config;
  }

  /** Configuration history for an event, newest first. */
  async history(eventId: string, scope: WorkspaceScope) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId: scope.workspaceId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    return this.prisma.eventPaymentConfig.findMany({
      where: { eventId },
      orderBy: { version: 'desc' },
      include: {
        beneficiaryAccount: { select: { id: true, label: true, status: true } },
        _count: { select: { entries: true } },
      },
    });
  }
}
