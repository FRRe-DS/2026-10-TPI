import { Module } from '@nestjs/common';
import { HealthController } from './modules/health/health.controller';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { SupportModule } from './modules/support/support.module';
import { SimulatorModule } from './modules/simulator/simulator.module';
import { CommonModule } from './common/common.module';

@Module({
  imports: [
    CommonModule,
    NotificationsModule,
    DocumentsModule,
    SupportModule,
    SimulatorModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
