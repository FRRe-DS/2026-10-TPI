import { SendNotificationUseCase } from './send-notification.use-case';
import { NotificationLogRepositoryPort } from '../../domain/ports/notification-log.repository.port';
import { NotificationSenderPort } from '../../domain/ports/notification-sender.port';
import { NotificationChannelDto } from '../dto/send-notification.dto';

describe('SendNotificationUseCase', () => {
  let useCase: SendNotificationUseCase;
  let sender: jest.Mocked<NotificationSenderPort>;
  let logRepository: jest.Mocked<NotificationLogRepositoryPort>;

  const dto = {
    channel: NotificationChannelDto.EMAIL,
    recipient: 'pasajero@ejemplo.com',
    subject: 'Actualización del viaje',
    content: 'Tu conductor está en camino.',
  };

  beforeEach(() => {
    sender = { send: jest.fn() } as jest.Mocked<NotificationSenderPort>;
    logRepository = {
      create: jest.fn().mockResolvedValue({ id: 'notification-1' }),
      findMany: jest.fn(),
    } as jest.Mocked<NotificationLogRepositoryPort>;
    useCase = new SendNotificationUseCase(sender, logRepository);
  });

  it('envía el email y registra el estado SENT', async () => {
    const result = await useCase.execute(dto);

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith(dto);
    expect(logRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ...dto,
        status: 'SENT',
        retryCount: 0,
        lastError: null,
      }),
    );
    expect(result).toEqual({ success: true, id: 'notification-1', status: 'SENT' });
  });

  it('reintenta tres veces y registra FAILED cuando todos los envíos SMTP fallan', async () => {
    sender.send.mockRejectedValue(new Error('SMTP no disponible'));

    const result = await useCase.execute(dto);

    expect(sender.send).toHaveBeenCalledTimes(4);
    expect(logRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ...dto,
        status: 'FAILED',
        retryCount: 3,
        lastError: 'SMTP no disponible',
      }),
    );
    expect(result).toEqual({ success: false, id: 'notification-1', status: 'FAILED' });
  });

  it('registra los reintentos usados si el envío finalmente tiene éxito', async () => {
    sender.send
      .mockRejectedValueOnce(new Error('SMTP temporalmente no disponible'))
      .mockResolvedValueOnce(undefined);

    const result = await useCase.execute(dto);

    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(logRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ...dto,
        status: 'SENT',
        retryCount: 1,
        lastError: null,
      }),
    );
    expect(result).toEqual({ success: true, id: 'notification-1', status: 'SENT' });
  });
});
