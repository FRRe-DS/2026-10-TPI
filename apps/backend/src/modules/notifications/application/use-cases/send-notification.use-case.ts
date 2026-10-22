import { Injectable, Logger } from '@nestjs/common';
import { SendNotificationDto } from '../dto/send-notification.dto';
import { NotificationLogRepositoryPort } from '../../domain/ports/notification-log.repository.port';
import { NotificationSenderPort } from '../../domain/ports/notification-sender.port';

@Injectable()
export class SendNotificationUseCase {
  private readonly logger = new Logger(SendNotificationUseCase.name);
  private readonly maxRetries = 3;

  constructor(
    private readonly sender: NotificationSenderPort,
    private readonly notificationLogRepository: NotificationLogRepositoryPort,
  ) {}

  async execute(dto: SendNotificationDto, eventId?: string, retryPending = false) {
    if (eventId && this.notificationLogRepository.findByEventId) {
      const existing = await this.notificationLogRepository.findByEventId(eventId);
      if (existing) {
        if (existing.status === 'SENT') {
          return {
            success: true,
            id: existing.id,
            status: 'SENT' as const,
            duplicate: true,
            retryable: false,
          };
        }
        if (existing.status === 'PENDING' && !retryPending) {
          return {
            success: false,
            id: existing.id,
            status: 'PENDING' as const,
            duplicate: true,
            retryable: true,
          };
        }
      }
    }

    let status: 'SENT' | 'FAILED' = 'SENT';
    let errorMessage: string | null = null;
    let retryCount = 0;

    if (dto.channel === 'EMAIL') {
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
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
          status = 'FAILED';
          if (attempt < this.maxRetries) {
            retryCount++;
            this.logger.warn(
              `Error enviando email: ${errorMessage}. Reintento ${retryCount}/${this.maxRetries}`,
            );
          } else {
            this.logger.warn(
              `Error enviando email a ${dto.recipient} luego de ${this.maxRetries} reintentos: ${errorMessage}`,
            );
          }
        }
      }
    } else {
      status = 'FAILED';
      errorMessage = `No hay un proveedor configurado para el canal ${dto.channel}.`;
      this.logger.warn(errorMessage);
    }

    const log = await this.notificationLogRepository.create({
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
      ...(eventId ? { retryable: status === 'FAILED' } : {}),
    };
  }
}
