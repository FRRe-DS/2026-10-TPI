import { Module } from '@nestjs/common';
import { HealthController } from './modules/health/health.controller';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { SupportModule } from './modules/support/support.module';
import { SimulatorModule } from './modules/simulator/simulator.module';
import { PrismaService } from './common/prisma.service';
import { RedisService } from './common/redis.service';

@Module({
  imports: [
    NotificationsModule,
    DocumentsModule,
    SupportModule,
    SimulatorModule,
  ],
  controllers: [HealthController],
  providers: [PrismaService, RedisService],
})
export class AppModule { }
