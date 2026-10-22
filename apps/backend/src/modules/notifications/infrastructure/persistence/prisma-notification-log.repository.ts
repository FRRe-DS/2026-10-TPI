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
    return this.prisma.notificationLog.create({
      data: {
        ...(log.eventId ? { eventId: log.eventId } : {}),
        channel: log.channel as any,
        recipient: log.recipient,
        subject: log.subject,
        content: log.content,
        status: log.status as any,
        retryCount: log.retryCount,
        lastError: log.lastError,
        referenceId: log.referenceId,
        referenceType: log.referenceType,
      },
    });
  }

  async findByEventId(eventId: string): Promise<NotificationLogRecord | null> {
    return this.prisma.notificationLog.findUnique({
      where: { eventId },
    }) as any;
  }

  async findMany(filters: NotificationLogFilters = {}): Promise<NotificationLogRecord[]> {
    return this.prisma.notificationLog.findMany({
      where: {
        recipient: filters.recipient ? { contains: filters.recipient } : undefined,
        status: filters.status as any,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }) as any;
  }
}
