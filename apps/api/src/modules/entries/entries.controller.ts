import { Body, Controller, Get, Ip, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { throttleConfig } from '../../common/throttle.config';
import { EntriesService } from './entries.service';
import { CreateEntryDto } from './dto/create-entry.dto';
import { SubmitReferenceDto } from './dto/submit-reference.dto';

/**
 * Public, unauthenticated guest endpoints. An entry is addressed by its opaque
 * accessToken, never by its database id.
 */
@Controller()
export class EntriesController {
  constructor(private readonly entries: EntriesService) {}

  @Post('events/:slug/entries')
  @Throttle({
    default: { limit: throttleConfig.guestWriteLimit, ttl: throttleConfig.globalTtlMs },
  })
  create(@Param('slug') slug: string, @Body() dto: CreateEntryDto, @Ip() ip: string) {
    return this.entries.createEntry(slug, dto, ip);
  }

  @Get('entries/:token/status')
  @Throttle({
    default: { limit: throttleConfig.guestReadLimit, ttl: throttleConfig.globalTtlMs },
  })
  status(@Param('token') token: string) {
    return this.entries.getStatus(token);
  }

  @Post('entries/:token/payment-reference')
  @Throttle({
    default: { limit: throttleConfig.guestWriteLimit, ttl: throttleConfig.globalTtlMs },
  })
  submitReference(
    @Param('token') token: string,
    @Body() dto: SubmitReferenceDto,
    @Ip() ip: string,
  ) {
    return this.entries.submitReference(token, dto, ip);
  }
}
