import { NotificationChannel } from './notification-sender.port';

export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface CreateNotificationLog {
  channel: NotificationChannel;
  recipient: string;
  subject: string;
  content: string;
  status: NotificationStatus;
  retryCount: number;
  lastError: string | null;
  referenceId?: string;
  referenceType?: string;
}

export interface NotificationLogRecord extends CreateNotificationLog {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationLogFilters {
  recipient?: string;
  status?: NotificationStatus;
}

export abstract class NotificationLogRepositoryPort {
  abstract create(log: CreateNotificationLog): Promise<Pick<NotificationLogRecord, 'id'>>;
  abstract findMany(filters?: NotificationLogFilters): Promise<NotificationLogRecord[]>;
}
