import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { throttleConfig } from './common/throttle.config';
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './modules/health/health.module';
import { EventsModule } from './modules/events/events.module';
import { EntriesModule } from './modules/entries/entries.module';
import { UpiModule } from './modules/upi/upi.module';
import { AdminAuthModule } from './modules/admin-auth/admin-auth.module';
import { AdminEventsModule } from './modules/admin-events/admin-events.module';
import { AdminEntriesModule } from './modules/admin-entries/admin-entries.module';
import { BankStatementsModule } from './modules/bank-statements/bank-statements.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { ReportsModule } from './modules/reports/reports.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { BeneficiariesModule } from './modules/beneficiaries/beneficiaries.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Baseline limit for every route; sensitive routes tighten it locally.
    ThrottlerModule.forRoot([
      { ttl: throttleConfig.globalTtlMs, limit: throttleConfig.globalLimit },
    ]),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '12h' },
      }),
    }),
    PrismaModule,
    AuditModule,
    WorkspacesModule,
    HealthModule,
    UpiModule,
    EventsModule,
    EntriesModule,
    ReconciliationModule,
    AdminAuthModule,
    AdminEventsModule,
    AdminEntriesModule,
    BankStatementsModule,
    BeneficiariesModule,
    ReportsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
