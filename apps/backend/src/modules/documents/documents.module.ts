import { Module } from '@nestjs/common';
import { DocumentsController } from './infrastructure/controllers/documents.controller';
import { DocumentsService } from './application/documents.service';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../../common/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, RedisService, PrismaService],
  exports: [DocumentsService],
})
export class DocumentsModule { }
