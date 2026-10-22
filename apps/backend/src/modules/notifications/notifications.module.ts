import { Module } from '@nestjs/common';
import { NotificationsController } from './infrastructure/controllers/notifications.controller';
import { NotificationsService } from './application/notifications.service';
import { PrismaService } from '../../common/prisma.service';
import { TripCompletedConsumer } from './infrastructure/messaging/trip-completed.consumer';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, PrismaService, TripCompletedConsumer],
  exports: [NotificationsService],
})
export class NotificationsModule { }
