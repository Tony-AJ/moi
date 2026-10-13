import { Global, Module } from '@nestjs/common';
import { WorkspaceAccessService } from './workspace-access.service';

/**
 * Global so every protected module resolves access through the same service
 * rather than growing its own, divergent isolation checks.
 */
@Global()
@Module({
  providers: [WorkspaceAccessService],
  exports: [WorkspaceAccessService],
})
export class WorkspacesModule {}
