import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminEventsService } from './admin-events.service';
import { CreateEventDto, UpdateEventDto } from './dto/event.dto';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentAdmin, type AdminPrincipal } from '../../common/decorators/current-admin.decorator';

@Controller('admin/events')
@UseGuards(AdminAuthGuard)
export class AdminEventsController {
  constructor(private readonly events: AdminEventsService) {}

  @Get()
  list() {
    return this.events.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.events.get(id);
  }

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateEventDto, @CurrentAdmin() admin: AdminPrincipal) {
    return this.events.create(dto, admin.id);
  }

  @Patch(':id')
  @Roles('OWNER')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.events.update(id, dto, admin.id);
  }
}
