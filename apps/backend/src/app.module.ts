import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './modules/health/health.controller';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { SupportModule } from './modules/support/support.module';
import { SimulatorModule } from './modules/simulator/simulator.module';
import { CommonModule } from './common/common.module';
import { JwtAuthGuard, RolesGuard } from './common/auth';

@Module({
  imports: [
    CommonModule,
    NotificationsModule,
    DocumentsModule,
    SupportModule,
    SimulatorModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
