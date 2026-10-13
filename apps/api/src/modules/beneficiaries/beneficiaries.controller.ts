import { Body, Controller, Get, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { BeneficiariesService } from './beneficiaries.service';
import { CreateBeneficiaryDto, SelectBeneficiaryDto } from './dto/beneficiary.dto';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { CurrentAdmin, type AdminPrincipal } from '../../common/decorators/current-admin.decorator';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';

@Controller('admin/beneficiaries')
@UseGuards(AdminAuthGuard)
export class BeneficiariesController {
  constructor(
    private readonly beneficiaries: BeneficiariesService,
    private readonly access: WorkspaceAccessService,
  ) {}

  @Get()
  async list(@CurrentAdmin() admin: AdminPrincipal, @Query('workspaceId') workspaceId?: string) {
    const scope = await this.access.resolveScope(admin, workspaceId);
    return this.beneficiaries.list(scope);
  }

  @Post()
  async create(
    @Body() dto: CreateBeneficiaryDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    const scope = await this.access.resolveScope(admin, dto.workspaceId);
    return this.beneficiaries.create(dto, scope, admin.id, ip);
  }

  @Post(':id/confirm')
  async confirm(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    const scope = await this.access.assertAccountAccess(admin, id);
    return this.beneficiaries.confirm(id, scope, admin.id, ip);
  }

  /** Points an event at one of the workspace's confirmed accounts. */
  @Post('events/:eventId/select')
  async select(
    @Param('eventId') eventId: string,
    @Body() dto: SelectBeneficiaryDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    const scope = await this.access.assertEventAccess(admin, eventId);
    return this.beneficiaries.selectForEvent(eventId, dto, scope, admin.id, ip);
  }

  @Get('events/:eventId/history')
  async history(@Param('eventId') eventId: string, @CurrentAdmin() admin: AdminPrincipal) {
    const scope = await this.access.assertEventAccess(admin, eventId);
    return this.beneficiaries.history(eventId, scope);
  }
}
