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

  async execute(dto: SendNotificationDto) {
    let status: 'SENT' | 'FAILED' = 'SENT';
    let errorMessage: string | null = null;
    let retryCount = 0;

    if (dto.channel === 'EMAIL') {
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          await this.sender.send(dto);
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
    }

    const log = await this.notificationLogRepository.create({
      channel: dto.channel,
      recipient: dto.recipient,
      subject: dto.subject,
      content: dto.content,
      status,
      retryCount,
      lastError: errorMessage,
      referenceId: dto.referenceId,
      referenceType: dto.referenceType,
    });

    return { success: status === 'SENT', id: log.id, status };
  }
}
