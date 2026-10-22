import { Module } from '@nestjs/common';
import { NotificationsController } from './infrastructure/controllers/notifications.controller';
import { NotificationsService } from './application/notifications.service';
import { PrismaService } from '../../common/prisma.service';
import { SendNotificationUseCase } from './application/use-cases/send-notification.use-case';
import { NotificationSenderPort } from './domain/ports/notification-sender.port';
import { NotificationLogRepositoryPort } from './domain/ports/notification-log.repository.port';
import { NodemailerEmailAdapter } from './infrastructure/adapters/nodemailer-email.adapter';
import { PrismaNotificationLogRepository } from './infrastructure/persistence/prisma-notification-log.repository';
import { TripCompletedConsumer } from './infrastructure/messaging/trip-completed.consumer';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    SendNotificationUseCase,
    PrismaService,
    { provide: NotificationSenderPort, useClass: NodemailerEmailAdapter },
    { provide: NotificationLogRepositoryPort, useClass: PrismaNotificationLogRepository },
    TripCompletedConsumer,
  ],
  exports: [NotificationsService, SendNotificationUseCase],
})
export class NotificationsModule {}
