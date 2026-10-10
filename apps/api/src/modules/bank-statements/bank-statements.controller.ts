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

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

@Controller('admin/bank-statements')
@UseGuards(AdminAuthGuard)
export class BankStatementsController {
  constructor(private readonly statements: BankStatementsService) {}

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
  import(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: MAX_UPLOAD_BYTES })
        .build({ fileIsRequired: true }),
    )
    file: any,
    @Body() body: { eventId?: string; autoReconcile?: string; force?: string },
    @CurrentAdmin() admin: AdminPrincipal,
    @Ip() ip: string,
  ) {
    return this.statements.import(
      file,
      {
        eventId: body.eventId || undefined,
        autoReconcile: body.autoReconcile === 'true' || body.autoReconcile === '1',
        force: body.force === 'true' || body.force === '1',
      },
      admin.id,
      ip,
    );
  }

  @Get('imports')
  imports(@Query('eventId') eventId?: string) {
    return this.statements.listImports(eventId);
  }

  @Get('transactions')
  transactions(
    @Query()
    query: {
      eventId?: string;
      importId?: string;
      direction?: 'CREDIT' | 'DEBIT';
      matched?: 'true' | 'false';
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    return this.statements.listTransactions(query);
  }
}
