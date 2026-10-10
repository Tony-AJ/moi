import { Controller, Get, Param } from '@nestjs/common';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get(':slug')
  getEvent(@Param('slug') slug: string) {
    return this.events.getPublicEvent(slug);
  }
}
