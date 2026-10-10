import { Module } from '@nestjs/common';
import { UpiService } from './upi.service';

@Module({
  providers: [UpiService],
  exports: [UpiService],
})
export class UpiModule {}
