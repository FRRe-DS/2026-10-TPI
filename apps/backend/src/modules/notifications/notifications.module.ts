import { Module } from '@nestjs/common';
import { NotificationsController } from './infrastructure/controllers/notifications.controller';
import { NotificationsService } from './application/notifications.service';
import { PrismaService } from '../../common/prisma.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, PrismaService],
  exports: [NotificationsService],
})
export class NotificationsModule { }
