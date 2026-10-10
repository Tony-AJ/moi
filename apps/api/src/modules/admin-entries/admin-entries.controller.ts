import { Body, Controller, Get, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminEntriesService } from './admin-entries.service';
import { QueryEntriesDto } from './dto/query-entries.dto';
import {
  AdminSubmitReferenceDto,
  CreateManualEntryDto,
  ReviewEntryDto,
} from './dto/entry-actions.dto';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { CurrentAdmin, type AdminPrincipal } from '../../common/decorators/current-admin.decorator';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminEntriesController {
  constructor(private readonly entries: AdminEntriesService) {}

  @Get('entries')
  list(@Query() query: QueryEntriesDto) {
    return this.entries.list(query);
  }

  @Get('stats')
  stats(@Query('eventId') eventId?: string) {
    return this.entries.stats(eventId);
  }

  @Get('entries/duplicates')
  duplicates(@Query('eventId') eventId: string) {
    return this.entries.duplicates(eventId);
  }

  @Get('entries/:id')
  get(@Param('id') id: string) {
    return this.entries.get(id);
  }

  @Post('entries')
  createManual(
    @Body() dto: CreateManualEntryDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    return this.entries.createManual(dto, admin.id, ip);
  }

  @Post('entries/:id/payment-reference')
  addReference(
    @Param('id') id: string,
    @Body() dto: AdminSubmitReferenceDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    return this.entries.addReference(id, dto, admin.id, ip);
  }

  @Post('entries/:id/review')
  review(
    @Param('id') id: string,
    @Body() dto: ReviewEntryDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    return this.entries.review(id, dto, admin.id, ip);
  }
}
