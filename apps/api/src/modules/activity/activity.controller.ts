import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { CurrentAdmin, type AdminPrincipal } from '../../common/decorators/current-admin.decorator';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { ActivityService } from './activity.service';

@Controller('admin/activity')
@UseGuards(AdminAuthGuard)
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly access: WorkspaceAccessService,
  ) {}

  @Get()
  async list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query('workspaceId') workspaceId?: string,
    @Query('eventId') eventId?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    // An explicit event is checked against the caller's assignments before
    // it is used as a filter, so another workspace's id is refused, not empty.
    const scope = eventId
      ? await this.access.assertEventAccess(admin, eventId)
      : await this.access.resolveScope(admin, workspaceId);
    return this.activity.list(scope, { eventId, before, limit: limit ? Number(limit) : undefined });
  }
}
