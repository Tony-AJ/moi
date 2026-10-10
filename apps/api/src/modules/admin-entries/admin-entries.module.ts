import { Module } from '@nestjs/common';
import { AdminEntriesController } from './admin-entries.controller';
import { AdminEntriesService } from './admin-entries.service';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';

@Module({
  imports: [ReconciliationModule],
  controllers: [AdminEntriesController],
  providers: [AdminEntriesService],
  exports: [AdminEntriesService],
})
export class AdminEntriesModule {}
