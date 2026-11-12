import { NotificationChannel } from './notification-sender.port';

export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface CreateNotificationLog {
  eventId?: string | null;
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

export type UpdateNotificationLog = Pick<
  CreateNotificationLog,
  'status' | 'retryCount' | 'lastError'
>;

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
  abstract update(
    id: string,
    log: UpdateNotificationLog,
  ): Promise<Pick<NotificationLogRecord, 'id'>>;
  abstract findByEventId(eventId: string): Promise<NotificationLogRecord | null>;
  abstract findById?(id: string): Promise<NotificationLogRecord | null>;
  abstract findMany(filters?: NotificationLogFilters): Promise<NotificationLogRecord[]>;
}
