import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpiService } from '../upi/upi.service';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly upi: UpiService,
  ) {}

  /** Public event payload. Deliberately exposes no guest data or totals. */
  async getPublicEvent(slug: string) {
    const event = await this.prisma.event.findUnique({
      where: { slug },
      select: {
        slug: true,
        name: true,
        hostName: true,
        eventDate: true,
        venue: true,
        suggestedAmounts: true,
        minAmountPaise: true,
        maxAmountPaise: true,
        collectPhone: true,
        requirePhone: true,
        isOpen: true,
        // The payee comes from the event's configured beneficiary snapshot,
        // never from a platform-wide default.
        activePaymentConfig: {
          select: { upiIdSnapshot: true, payeeNameSnapshot: true },
        },
        workspace: { select: { status: true } },
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const { activePaymentConfig, workspace, ...rest } = event;
    const payee = activePaymentConfig
      ? {
          upiId: activePaymentConfig.upiIdSnapshot,
          upiPayeeName: activePaymentConfig.payeeNameSnapshot,
        }
      : { upiId: null, upiPayeeName: null };

    return {
      ...rest,
      // A suspended workspace closes the guest form regardless of isOpen.
      isOpen: rest.isOpen && (!workspace || workspace.status === 'ACTIVE'),
      upiConfigured: this.upi.isConfigured(payee),
      payeeName: this.upi.resolvePayee(payee).name,
    };
  }
}
