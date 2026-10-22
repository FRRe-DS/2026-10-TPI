import { BadRequestException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SendNotificationUseCase } from './use-cases/send-notification.use-case';
import { NotificationLogRepositoryPort } from '../domain/ports/notification-log.repository.port';
import { NotificationChannelDto, SendNotificationDto } from './dto/send-notification.dto';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let useCaseMock: jest.Mocked<SendNotificationUseCase>;
  let repoMock: jest.Mocked<NotificationLogRepositoryPort>;

  const notification: SendNotificationDto = {
    channel: NotificationChannelDto.EMAIL,
    recipient: 'pasajero@ejemplo.com',
    subject: 'Tu conductor está en camino',
    content: 'El conductor llegará en 3 minutos.',
  };

  beforeEach(() => {
    useCaseMock = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        id: 'notification-1',
        status: 'SENT',
      }),
    } as unknown as jest.Mocked<SendNotificationUseCase>;

    repoMock = {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([
        { id: 'log-1', recipient: 'pasajero@ejemplo.com', status: 'SENT' },
      ]),
    } as unknown as jest.Mocked<NotificationLogRepositoryPort>;

    service = new NotificationsService(useCaseMock, repoMock);
  });

  it('delega el envío a SendNotificationUseCase pasando eventId y retryPending', async () => {
    const result = await service.send(notification, 'event-1', true);

    expect(useCaseMock.execute).toHaveBeenCalledWith(notification, 'event-1', true);
    expect(result).toEqual({
      success: true,
      id: 'notification-1',
      status: 'SENT',
    });
  });

  it('obtiene los logs filtrando por destinatario y estado válido', async () => {
    const logs = await service.getLogs('pasajero@ejemplo.com', 'SENT');

    expect(repoMock.findMany).toHaveBeenCalledWith({
      recipient: 'pasajero@ejemplo.com',
      status: 'SENT',
    });
    expect(logs).toHaveLength(1);
  });

  it('rechaza estados de notificación inválidos en getLogs con BadRequestException', async () => {
    await expect(service.getLogs(undefined, 'INVALID_STATUS')).rejects.toThrow(
      BadRequestException,
    );
  });
});
