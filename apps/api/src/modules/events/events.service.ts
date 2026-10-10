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
        upiId: true,
        upiPayeeName: true,
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const { upiId, upiPayeeName, ...rest } = event;
    const payee = this.upi.resolvePayee({ upiId, upiPayeeName });

    return {
      ...rest,
      upiConfigured: this.upi.isConfigured({ upiId, upiPayeeName }),
      payeeName: payee.name,
    };
  }
}
