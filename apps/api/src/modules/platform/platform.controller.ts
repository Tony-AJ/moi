import { Body, Controller, Get, Ip, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { PlatformAdminOnly } from '../../common/decorators/platform-admin.decorator';
import { CurrentAdmin, type AdminPrincipal } from '../../common/decorators/current-admin.decorator';
import { PlatformService } from './platform.service';
import {
  AddWorkspaceEventDto,
  ProvisionOrganizerDto,
  SetPasswordDto,
  UpdatePlatformUserDto,
  UpdateWorkspaceStatusDto,
} from './dto/platform.dto';

/**
 * Super admin console. Every route requires PlatformRole SUPER_ADMIN, and
 * none of them return guest data; see PlatformService.
 */
@Controller('admin/platform')
@UseGuards(AdminAuthGuard)
@PlatformAdminOnly()
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('overview')
  overview() {
    return this.platform.overview();
  }

  /** Creates the workspace, the event and the organizer login together. */
  @Post('organizers')
  provision(
    @Body() dto: ProvisionOrganizerDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    return this.platform.provisionOrganizer(dto, admin, ip);
  }

  @Post('workspaces/:workspaceId/events')
  addEvent(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: AddWorkspaceEventDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    return this.platform.addEvent(workspaceId, dto, admin, ip);
  }

  @Patch('workspaces/:workspaceId')
  updateWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateWorkspaceStatusDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    return this.platform.updateWorkspaceStatus(workspaceId, dto, admin, ip);
  }

  /**
   * Sets an organizer's password, typed by the super admin or generated.
   * The old one stops working at once.
   */
  @Post('users/:userId/reset-password')
  resetPassword(
    @Param('userId') userId: string,
    @Body() dto: SetPasswordDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    return this.platform.resetPassword(userId, dto, admin, ip);
  }

  @Patch('users/:userId')
  updateUser(
    @Param('userId') userId: string,
    @Body() dto: UpdatePlatformUserDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    return this.platform.updateUser(userId, dto, admin, ip);
  }
}
