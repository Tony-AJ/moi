import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { AdminEventsModule } from '../admin-events/admin-events.module';

@Module({
  imports: [AdminEventsModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
