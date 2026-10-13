import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { CurrentAdmin, type AdminPrincipal } from '../../common/decorators/current-admin.decorator';
import { ReconciliationService } from './reconciliation.service';
import { RunReconciliationDto } from './dto/run-reconciliation.dto';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';

@Controller('admin/reconciliation')
@UseGuards(AdminAuthGuard)
export class ReconciliationController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly access: WorkspaceAccessService,
  ) {}

  /** Re-runs matching for every unverified UPI entry of an event. */
  @Post('run')
  async run(@Body() dto: RunReconciliationDto, @CurrentAdmin() admin: AdminPrincipal) {
    const { eventId, ...options } = dto;
    await this.access.assertEventAccess(admin, eventId, 'canResolveReviews');
    return this.reconciliation.runForEvent(eventId, options, admin.id);
  }

  /** Re-runs matching for a single entry. */
  @Post('entries/:entryId/run')
  async runOne(@Param('entryId') entryId: string, @CurrentAdmin() admin: AdminPrincipal) {
    await this.access.assertEntryAccess(admin, entryId, 'canResolveReviews');
    return this.reconciliation.matchEntry(entryId, {}, admin.id);
  }

  /** Bank credits an admin may choose from while resolving a review. */
  @Get('entries/:entryId/candidates')
  async candidates(
    @Param('entryId') entryId: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    await this.access.assertEntryAccess(admin, entryId, 'canResolveReviews');
    return this.reconciliation.findCandidates(entryId);
  }
}
