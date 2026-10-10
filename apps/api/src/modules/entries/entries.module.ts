import { Module } from '@nestjs/common';
import { EntriesController } from './entries.controller';
import { EntriesService } from './entries.service';
import { UpiModule } from '../upi/upi.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';

@Module({
  imports: [UpiModule, ReconciliationModule],
  controllers: [EntriesController],
  providers: [EntriesService],
})
export class EntriesModule {}
