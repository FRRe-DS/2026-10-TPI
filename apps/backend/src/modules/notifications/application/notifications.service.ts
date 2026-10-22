import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SendNotificationDto } from './dto/send-notification.dto';
import { SendNotificationUseCase } from './use-cases/send-notification.use-case';
import {
  NotificationLogRepositoryPort,
  NotificationStatus,
} from '../domain/ports/notification-log.repository.port';

const isNotificationStatus = (status: string): status is NotificationStatus =>
  status === 'PENDING' || status === 'SENT' || status === 'FAILED';

export interface NotificationSendResult {
  success: boolean;
  id: string;
  status: NotificationStatus;
  duplicate?: boolean;
  retryable?: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly sendNotificationUseCase: SendNotificationUseCase,
    private readonly notificationLogRepository: NotificationLogRepositoryPort,
  ) {}

  async send(
    dto: SendNotificationDto,
    eventId?: string,
    retryPending = false,
  ): Promise<NotificationSendResult> {
    this.logger.log(`Enviando notificación [${dto.channel}] a: ${dto.recipient}`);
    return this.sendNotificationUseCase.execute(dto, eventId, retryPending);
  }

  async getLogs(recipient?: string, status?: string) {
    let notificationStatus: NotificationStatus | undefined;
    if (status) {
      if (!isNotificationStatus(status)) {
        throw new BadRequestException(`Estado de notificación inválido: ${status}`);
      }
      notificationStatus = status;
    }

    return this.notificationLogRepository.findMany({
      recipient,
      status: notificationStatus,
    });
  }
}
