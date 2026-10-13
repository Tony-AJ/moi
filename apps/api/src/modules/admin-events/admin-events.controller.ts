import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminEventsService } from './admin-events.service';
import { CreateEventDto, UpdateEventDto } from './dto/event.dto';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { CurrentAdmin, type AdminPrincipal } from '../../common/decorators/current-admin.decorator';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';

@Controller('admin/events')
@UseGuards(AdminAuthGuard)
export class AdminEventsController {
  constructor(
    private readonly events: AdminEventsService,
    private readonly access: WorkspaceAccessService,
  ) {}

  @Get()
  async list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query('workspaceId') workspaceId?: string,
  ) {
    const scope = await this.access.resolveScope(admin, workspaceId);
    return this.events.list(scope);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentAdmin() admin: AdminPrincipal) {
    const scope = await this.access.assertEventAccess(admin, id);
    return this.events.get(id, scope);
  }

  @Post()
  async create(
    @Body() dto: CreateEventDto & { workspaceId?: string },
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    const scope = await this.access.resolveScope(admin, dto.workspaceId);
    if (scope.role === 'EVENT_STAFF') {
      throw new ForbiddenException('Only a workspace owner or admin can create events');
    }
    return this.events.create(dto, admin.id, scope);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    const scope = await this.access.assertEventAccess(admin, id);
    if (scope.role === 'EVENT_STAFF') {
      throw new ForbiddenException('Only a workspace owner or admin can change an event');
    }
    return this.events.update(id, dto, admin.id, scope);
  }
}
