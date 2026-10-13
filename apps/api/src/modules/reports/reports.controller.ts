import { BadRequestException, Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { QueryEntriesDto } from '../admin-entries/dto/query-entries.dto';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { CurrentAdmin, type AdminPrincipal } from '../../common/decorators/current-admin.decorator';
import { AuditService } from '../audit/audit.service';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';

@Controller('admin/reports')
@UseGuards(AdminAuthGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
    private readonly access: WorkspaceAccessService,
  ) {}

  @Get('export')
  async export(
    @Query() query: QueryEntriesDto & { format?: string },
    @Res() res: Response,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    // An export is a bulk read of guest personal data, so the scope is
    // resolved from membership and the report is restricted to it.
    const scope = await this.access.resolveScope(admin, query.workspaceId);
    if (query.eventId) {
      await this.access.assertEventAccess(admin, query.eventId, 'canExportReports');
    }

    const format = (query.format ?? 'xlsx').toLowerCase();
    if (format !== 'xlsx' && format !== 'pdf') {
      throw new BadRequestException('format must be xlsx or pdf');
    }

    const scoped = { ...query, workspaceId: scope.workspaceId };
    const result =
      format === 'xlsx'
        ? await this.reports.buildExcel(scoped, scope)
        : await this.reports.buildPdf(scoped, scope);

    await this.audit.record({
      adminUserId: admin.id,
      action: 'REPORT_EXPORTED',
      entityType: 'Event',
      entityId: query.eventId ?? null,
      workspaceId: scope.workspaceId,
      metadata: { format, filters: { ...query } },
    });

    res.setHeader(
      'Content-Type',
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="' + result.filename + '"');
    res.setHeader('Content-Length', String(result.buffer.length));
    res.end(result.buffer);
  }
}
