import { Module } from '@nestjs/common';
import { SimulatorController } from './simulator.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [NotificationsModule, DocumentsModule],
  controllers: [SimulatorController],
})
export class SimulatorModule { }
