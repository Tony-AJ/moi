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
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminEntriesController {
  constructor(
    private readonly entries: AdminEntriesService,
    private readonly access: WorkspaceAccessService,
  ) {}

  @Get('entries')
  async list(@Query() query: QueryEntriesDto, @CurrentAdmin() admin: AdminPrincipal) {
    // An event, when given, decides the workspace: asserted rather than just
    // filtered, so a foreign event id is an explicit refusal, not an empty
    // page. It also lets the super admin open one event without naming its
    // workspace separately.
    const scope = query.eventId
      ? await this.access.assertEventAccess(admin, query.eventId)
      : await this.access.resolveScope(admin, query.workspaceId);
    return this.entries.list(query, scope);
  }

  @Get('stats')
  async stats(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query('eventId') eventId?: string,
    @Query('workspaceId') workspaceId?: string,
  ) {
    const scope = eventId
      ? await this.access.assertEventAccess(admin, eventId)
      : await this.access.resolveScope(admin, workspaceId);
    return this.entries.stats(scope, eventId);
  }

  @Get('entries/duplicates')
  async duplicates(@Query('eventId') eventId: string, @CurrentAdmin() admin: AdminPrincipal) {
    await this.access.assertEventAccess(admin, eventId);
    return this.entries.duplicates(eventId);
  }

  @Get('entries/:id')
  async get(@Param('id') id: string, @CurrentAdmin() admin: AdminPrincipal) {
    await this.access.assertEntryAccess(admin, id);
    return this.entries.get(id);
  }

  @Post('entries')
  async createManual(
    @Body() dto: CreateManualEntryDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    await this.access.assertEventAccess(admin, dto.eventId, 'canRecordEntries');
    return this.entries.createManual(dto, admin.id, ip);
  }

  @Post('entries/:id/payment-reference')
  async addReference(
    @Param('id') id: string,
    @Body() dto: AdminSubmitReferenceDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    await this.access.assertEntryAccess(admin, id, 'canRecordEntries');
    return this.entries.addReference(id, dto, admin.id, ip);
  }

  @Post('entries/:id/review')
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewEntryDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    await this.access.assertEntryAccess(admin, id, 'canResolveReviews');
    return this.entries.review(id, dto, admin.id, ip);
  }
}
