import { Injectable, Logger } from '@nestjs/common';
import { SendNotificationDto } from '../dto/send-notification.dto';
import {
  NotificationLogRecord,
  NotificationLogRepositoryPort,
} from '../../domain/ports/notification-log.repository.port';
import { NotificationSenderPort } from '../../domain/ports/notification-sender.port';

@Injectable()
export class SendNotificationUseCase {
  private readonly logger = new Logger(SendNotificationUseCase.name);
  private readonly maxRetries = 3;

  constructor(
    private readonly sender: NotificationSenderPort,
    private readonly notificationLogRepository: NotificationLogRepositoryPort,
  ) {}

  async execute(
    dto: SendNotificationDto,
    eventId?: string,
    retryPending = false,
    deferRetriesToQueue = false,
  ) {
    let existingLog: NotificationLogRecord | null = null;
    if (eventId) {
      existingLog = await this.notificationLogRepository.findByEventId(eventId);
      if (existingLog) {
        if (existingLog.status === 'SENT') {
          return {
            success: true,
            id: existingLog.id,
            status: 'SENT' as const,
            duplicate: true,
            retryable: false,
          };
        }
        if (existingLog.status === 'PENDING' && !retryPending) {
          return {
            success: false,
            id: existingLog.id,
            status: 'PENDING' as const,
            duplicate: true,
            retryable: true,
          };
        }
      }
    }

    let status: 'SENT' | 'PENDING' | 'FAILED' = 'SENT';
    let errorMessage: string | null = null;
    let retryCount = 0;
    const maxRetries = deferRetriesToQueue ? 0 : this.maxRetries;

    if (dto.channel === 'EMAIL') {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          await this.sender.send({
            channel: dto.channel as any,
            recipient: dto.recipient,
            subject: dto.subject,
            content: dto.content,
            ...(dto.attachments ? { attachments: dto.attachments } : {}),
            ...(eventId ? { messageId: `<${eventId}@movilidadurbana.local>` } : {}),
          });
          status = 'SENT';
          errorMessage = null;
          this.logger.log(`Email enviado a ${dto.recipient}`);
          break;
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
          status = deferRetriesToQueue ? 'PENDING' : 'FAILED';
          if (attempt < maxRetries) {
            retryCount++;
            this.logger.warn(
              `Error enviando email: ${errorMessage}. Reintento ${retryCount}/${maxRetries}`,
            );
          } else {
            this.logger.warn(
              `Error enviando email a ${dto.recipient} luego de ${maxRetries} reintentos: ${errorMessage}`,
            );
          }
        }
      }
    } else {
      status = 'FAILED';
      errorMessage = `No hay un proveedor configurado para el canal ${dto.channel}.`;
      this.logger.warn(errorMessage);
    }

    const log = existingLog
      ? await this.notificationLogRepository.update(existingLog.id, {
          status,
          retryCount: existingLog.retryCount + retryCount + 1,
          lastError: errorMessage,
        })
      : await this.notificationLogRepository.create({
          eventId: eventId || null,
          channel: dto.channel as any,
          recipient: dto.recipient,
          subject: dto.subject,
          content: dto.content,
          status,
          retryCount,
          lastError: errorMessage,
          referenceId: dto.referenceId,
          referenceType: dto.referenceType,
        });

    return {
      success: status === 'SENT',
      id: log.id,
      status,
      ...(eventId ? { retryable: status !== 'SENT' } : {}),
    };
  }
}
