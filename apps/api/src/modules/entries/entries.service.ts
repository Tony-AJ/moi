import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MoiEntry, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpiService } from '../upi/upi.service';
import { AuditService } from '../audit/audit.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { CreateEntryDto } from './dto/create-entry.dto';
import { SubmitReferenceDto } from './dto/submit-reference.dto';
import { buildEntryCode, generateAccessToken } from '../../common/utils/token.util';
import { normalizePhone, normalizeReference } from '../../common/utils/normalize.util';
import { formatInr } from '../../common/utils/money.util';

const STATUS_COPY: Record<string, string> = {
  AWAITING_VERIFICATION:
    'We have recorded your contribution. It will show as verified once it is matched against the bank statement.',
  VERIFIED: 'Your contribution has been verified against the bank record. Thank you.',
  REVIEW_REQUIRED:
    'The organizer is reviewing this contribution manually. No action is needed from you right now.',
  NOT_FOUND:
    'We could not find this payment in the statement yet. Bank statements can lag by a day or two — the organizer will check again.',
  REJECTED: 'The organizer marked this entry as not received. Please contact them if this is wrong.',
};

@Injectable()
export class EntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly upi: UpiService,
    private readonly audit: AuditService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  async createEntry(slug: string, dto: CreateEntryDto, ip?: string) {
    const event = await this.prisma.event.findUnique({
      where: { slug },
      include: { activePaymentConfig: true, workspace: { select: { status: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (!event.isOpen) {
      throw new ForbiddenException('This event is no longer accepting entries');
    }
    // A suspended customer stops collecting immediately.
    if (event.workspace && event.workspace.status !== 'ACTIVE') {
      throw new ForbiddenException('This event is no longer accepting entries');
    }

    const method = dto.paymentMethod ?? 'UPI';

    // No beneficiary, no UPI handoff. Taking the entry anyway would show the
    // guest a payment screen with no verified destination, and there used to
    // be a platform-wide default that would have taken the money into the
    // wrong account.
    if (method === 'UPI' && !event.activePaymentConfig) {
      throw new ForbiddenException(
        'This event is not yet set up to receive online payments. Please contact the host.',
      );
    }

    if (dto.amountPaise < event.minAmountPaise) {
      throw new BadRequestException(
        'Minimum contribution for this event is ' + formatInr(event.minAmountPaise),
      );
    }
    if (dto.amountPaise > event.maxAmountPaise) {
      throw new BadRequestException(
        'Maximum contribution for this event is ' + formatInr(event.maxAmountPaise),
      );
    }
    if (event.requirePhone && !dto.guestPhone) {
      throw new BadRequestException('Phone number is required for this event');
    }

    // Idempotency: a retried submit with the same key returns the first entry.
    if (dto.clientRequestId) {
      const existing = await this.prisma.moiEntry.findUnique({
        where: {
          eventId_clientRequestId: {
            eventId: event.id,
            clientRequestId: dto.clientRequestId,
          },
        },
      });
      if (existing) {
        return this.toGuestView(existing, event, { deduplicated: true }, event.activePaymentConfig);
      }
    }

    const entry = await this.prisma.$transaction(async (tx) => {
      // Atomic per-event counter: the returned value is this entry's number.
      const updated = await tx.event.update({
        where: { id: event.id },
        data: { entrySequence: { increment: 1 } },
        select: { entrySequence: true },
      });
      const entryNumber = updated.entrySequence;

      return tx.moiEntry.create({
        data: {
          eventId: event.id,
          entryNumber,
          entryCode: buildEntryCode(entryNumber),
          guestName: dto.guestName,
          guestAddress: dto.guestAddress || null,
          guestPhone: normalizePhone(dto.guestPhone),
          relation: dto.relation || null,
          amountPaise: dto.amountPaise,
          paymentMethod: method,
          // Pins the beneficiary that was live at this moment, so a later
          // change of account cannot rewrite where this contribution went.
          paymentConfigId: method === 'UPI' ? event.activePaymentConfig?.id ?? null : null,
          // Never trust the client for status. Everything starts unverified.
          paymentStatus: 'AWAITING_VERIFICATION',
          accessToken: generateAccessToken(),
          clientRequestId: dto.clientRequestId || null,
          note: dto.note || null,
        },
      });
    });

    await this.audit.record({
      action: 'ENTRY_CREATED',
      entityType: 'MoiEntry',
      entityId: entry.id,
      ip,
      workspaceId: event.workspaceId,
      metadata: {
        eventId: event.id,
        entryCode: entry.entryCode,
        amountPaise: entry.amountPaise,
        paymentMethod: entry.paymentMethod,
      },
    });

    const possibleDuplicate = await this.findPossibleDuplicate(entry);

    return this.toGuestView(entry, event, { possibleDuplicate }, event.activePaymentConfig);
  }

  async getStatus(token: string) {
    const entry = await this.prisma.moiEntry.findUnique({
      where: { accessToken: token },
      include: {
        event: true,
        // The pinned snapshot, so the status page keeps showing the payee the
        // guest was originally sent to even if the host has since switched
        // the event to a different account.
        paymentConfig: true,
        paymentClaims: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!entry) throw new NotFoundException('Entry not found');

    return this.toGuestView(
      entry,
      entry.event,
      {
        claims: entry.paymentClaims.map((claim) => ({
          utr: claim.utr,
          status: claim.status,
          submittedAt: claim.createdAt,
        })),
      },
      entry.paymentConfig,
    );
  }

  async submitReference(token: string, dto: SubmitReferenceDto, ip?: string) {
    const normalized = normalizeReference(dto.utr);
    if (!normalized || normalized.length < 6) {
      throw new BadRequestException('That reference number does not look valid');
    }

    const entry = await this.prisma.moiEntry.findUnique({
      where: { accessToken: token },
      include: { event: true, paymentClaims: true },
    });
    if (!entry) throw new NotFoundException('Entry not found');

    if (entry.paymentStatus === 'VERIFIED') {
      return this.getStatus(token);
    }

    const alreadyOnThisEntry = entry.paymentClaims.find((c) => c.utrNormalized === normalized);
    if (alreadyOnThisEntry) {
      return this.getStatus(token);
    }

    // utrNormalized is unique across the whole platform, which is what stops
    // the same transaction being claimed twice. A real UTR is globally unique
    // too, so a collision across two workspaces means one of them mistyped
    // it. The message below deliberately does not say which contribution
    // holds the reference, so this cannot be used to probe another
    // customer's records.
    const clash = await this.prisma.paymentClaim.findUnique({
      where: { utrNormalized: normalized },
      select: { entryId: true },
    });
    if (clash && clash.entryId !== entry.id) {
      throw new ConflictException(
        'This transaction reference is already recorded against another contribution. Please check the reference and try again.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Keep the history, but only the newest claim is treated as current.
      await tx.paymentClaim.updateMany({
        where: { entryId: entry.id, status: 'CLAIMED' },
        data: { status: 'SUPERSEDED' },
      });
      await tx.paymentClaim.create({
        data: {
          entryId: entry.id,
          utr: dto.utr,
          utrNormalized: normalized,
          source: 'GUEST',
          status: 'CLAIMED',
        },
      });
      await tx.moiEntry.update({
        where: { id: entry.id },
        // A claimed reference is never proof of payment.
        data: { paymentStatus: 'AWAITING_VERIFICATION', reviewReason: null },
      });
    });

    await this.audit.record({
      action: 'PAYMENT_REFERENCE_CLAIMED',
      entityType: 'MoiEntry',
      entityId: entry.id,
      ip,
      metadata: { utrNormalized: normalized, source: 'GUEST' },
    });

    // Opportunistic match: if the statement containing this credit was already
    // imported, the entry can verify immediately. Otherwise it stays pending.
    try {
      await this.reconciliation.matchEntry(entry.id);
    } catch {
      // Matching is best-effort here; the admin can always re-run it.
    }

    return this.getStatus(token);
  }

  /** Same name + same amount on the same event within 10 minutes. */
  private async findPossibleDuplicate(entry: MoiEntry): Promise<boolean> {
    const since = new Date(entry.createdAt.getTime() - 10 * 60 * 1000);
    const count = await this.prisma.moiEntry.count({
      where: {
        eventId: entry.eventId,
        id: { not: entry.id },
        guestName: { equals: entry.guestName, mode: 'insensitive' },
        amountPaise: entry.amountPaise,
        createdAt: { gte: since },
      },
    });
    return count > 0;
  }

  private toGuestView(
    entry: MoiEntry,
    event: Prisma.EventGetPayload<{}>,
    extra: Record<string, unknown> = {},
    paymentConfig?: { upiIdSnapshot: string; payeeNameSnapshot: string } | null,
  ) {
    // Built from the snapshot pinned to this entry rather than from the
    // event's current columns, so the guest is handed the same payee the
    // entry will later be reconciled against.
    const payee = paymentConfig
      ? { upiId: paymentConfig.upiIdSnapshot, upiPayeeName: paymentConfig.payeeNameSnapshot }
      : null;

    const upi =
      entry.paymentMethod === 'UPI' && payee && this.upi.isConfigured(payee)
        ? this.upi.buildHandoff({
            event: { ...payee, name: event.name },
            amountPaise: entry.amountPaise,
            entryCode: entry.entryCode,
          })
        : null;

    return {
      entryCode: entry.entryCode,
      accessToken: entry.accessToken,
      guestName: entry.guestName,
      guestAddress: entry.guestAddress,
      amountPaise: entry.amountPaise,
      amountDisplay: formatInr(entry.amountPaise),
      paymentMethod: entry.paymentMethod,
      paymentStatus: entry.paymentStatus,
      statusMessage: STATUS_COPY[entry.paymentStatus] ?? '',
      createdAt: entry.createdAt,
      verifiedAt: entry.verifiedAt,
      event: {
        slug: event.slug,
        name: event.name,
        hostName: event.hostName,
        eventDate: event.eventDate,
        venue: event.venue,
      },
      upi,
      ...extra,
    };
  }
}
