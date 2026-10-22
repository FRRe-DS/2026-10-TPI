export type NotificationChannel = 'EMAIL' | 'PUSH' | 'SMS';

export interface NotificationAttachment {
  filename: string;
  content: Buffer | Uint8Array | string;
  contentType?: string;
}

export interface NotificationMessage {
  channel: NotificationChannel;
  recipient: string;
  subject: string;
  content: string;
  attachments?: NotificationAttachment[];
  messageId?: string;
}

export abstract class NotificationSenderPort {
  abstract send(notification: NotificationMessage): Promise<void>;
}
