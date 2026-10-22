import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/prisma.service';
import {
  CreateNotificationLog,
  NotificationLogFilters,
  NotificationLogRecord,
  NotificationLogRepositoryPort,
} from '../../domain/ports/notification-log.repository.port';

@Injectable()
export class PrismaNotificationLogRepository extends NotificationLogRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(log: CreateNotificationLog): Promise<Pick<NotificationLogRecord, 'id'>> {
    return this.prisma.notificationLog.create({ data: log });
  }

  async findMany(filters: NotificationLogFilters = {}): Promise<NotificationLogRecord[]> {
    return this.prisma.notificationLog.findMany({
      where: {
        recipient: filters.recipient ? { contains: filters.recipient } : undefined,
        status: filters.status,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
