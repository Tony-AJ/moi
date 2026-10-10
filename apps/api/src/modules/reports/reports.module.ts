import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AdminEntriesModule } from '../admin-entries/admin-entries.module';

@Module({
  imports: [AdminEntriesModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
