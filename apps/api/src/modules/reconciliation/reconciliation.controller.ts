import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { CurrentAdmin, type AdminPrincipal } from '../../common/decorators/current-admin.decorator';
import { ReconciliationService } from './reconciliation.service';
import { RunReconciliationDto } from './dto/run-reconciliation.dto';

@Controller('admin/reconciliation')
@UseGuards(AdminAuthGuard)
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  /** Re-runs matching for every unverified UPI entry of an event. */
  @Post('run')
  run(@Body() dto: RunReconciliationDto, @CurrentAdmin() admin: AdminPrincipal) {
    const { eventId, ...options } = dto;
    return this.reconciliation.runForEvent(eventId, options, admin.id);
  }

  /** Re-runs matching for a single entry. */
  @Post('entries/:entryId/run')
  runOne(@Param('entryId') entryId: string, @CurrentAdmin() admin: AdminPrincipal) {
    return this.reconciliation.matchEntry(entryId, {}, admin.id);
  }

  /** Bank credits an admin may choose from while resolving a review. */
  @Get('entries/:entryId/candidates')
  candidates(@Param('entryId') entryId: string) {
    return this.reconciliation.findCandidates(entryId);
  }
}
