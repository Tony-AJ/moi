import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Ip,
  ParseFilePipeBuilder,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BankStatementsService } from './bank-statements.service';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { CurrentAdmin, type AdminPrincipal } from '../../common/decorators/current-admin.decorator';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

@Controller('admin/bank-statements')
@UseGuards(AdminAuthGuard)
export class BankStatementsController {
  constructor(
    private readonly statements: BankStatementsService,
    private readonly access: WorkspaceAccessService,
  ) {}

  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      fileFilter: (_req, file, callback) => {
        const ok = /\.(csv|xlsx|xls)$/i.test(file.originalname);
        callback(ok ? null : new BadRequestException('Upload a CSV or XLSX statement'), ok);
      },
    }),
  )
  async import(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: MAX_UPLOAD_BYTES })
        .build({ fileIsRequired: true }),
    )
    file: any,
    @Body()
    body: {
      beneficiaryAccountId?: string;
      eventId?: string;
      autoReconcile?: string;
      force?: string;
    },
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    if (!body.beneficiaryAccountId) {
      throw new BadRequestException(
        'beneficiaryAccountId is required: a statement has to be attached to the account it came from.',
      );
    }

    // Checked before the file is parsed, and against the membership rows
    // rather than against the id the browser sent.
    await this.access.assertAccountAccess(admin, body.beneficiaryAccountId);
    if (body.eventId) {
      await this.access.assertEventAccess(admin, body.eventId, 'canUploadStatements');
    }

    return this.statements.import(
      file,
      {
        beneficiaryAccountId: body.beneficiaryAccountId,
        eventId: body.eventId || undefined,
        autoReconcile: body.autoReconcile === 'true' || body.autoReconcile === '1',
        force: body.force === 'true' || body.force === '1',
      },
      admin.id,
      ip,
    );
  }

  @Get('imports')
  async imports(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query('eventId') eventId?: string,
    @Query('workspaceId') workspaceId?: string,
  ) {
    const scope = await this.access.resolveScope(admin, workspaceId);
    if (eventId) await this.access.assertEventAccess(admin, eventId);
    return this.statements.listImports({ workspaceId: scope.workspaceId, eventId });
  }

  @Get('transactions')
  async transactions(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query()
    query: {
      workspaceId?: string;
      eventId?: string;
      importId?: string;
      direction?: 'CREDIT' | 'DEBIT';
      matched?: 'true' | 'false';
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const scope = await this.access.resolveScope(admin, query.workspaceId);
    if (query.eventId) await this.access.assertEventAccess(admin, query.eventId);
    // The resolved workspace overrides whatever the query string asked for.
    return this.statements.listTransactions({ ...query, workspaceId: scope.workspaceId });
  }
}
