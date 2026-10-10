import { Module } from '@nestjs/common';
import { BankStatementsController } from './bank-statements.controller';
import { BankStatementsService } from './bank-statements.service';
import { StatementParserService } from './statement-parser.service';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';

@Module({
  imports: [ReconciliationModule],
  controllers: [BankStatementsController],
  providers: [BankStatementsService, StatementParserService],
  exports: [BankStatementsService, StatementParserService],
})
export class BankStatementsModule {}
