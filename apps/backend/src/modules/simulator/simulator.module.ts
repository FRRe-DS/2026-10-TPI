import { Module } from '@nestjs/common';
import { SimulatorController } from './simulator.controller';
import { EventsController } from './events.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [NotificationsModule, DocumentsModule],
  controllers: [SimulatorController, EventsController],
})
export class SimulatorModule {}
