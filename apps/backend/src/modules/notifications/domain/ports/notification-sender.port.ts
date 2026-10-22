export type NotificationChannel = 'EMAIL' | 'PUSH' | 'SMS';

export interface NotificationMessage {
  channel: NotificationChannel;
  recipient: string;
  subject: string;
  content: string;
}

export abstract class NotificationSenderPort {
  abstract send(notification: NotificationMessage): Promise<void>;
}
