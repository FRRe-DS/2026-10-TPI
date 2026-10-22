import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from '../../application/notifications.service';
import { NotificationChannelDto } from '../../application/dto/send-notification.dto';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: {
    send: jest.Mock;
    getLogs: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      send: jest.fn().mockResolvedValue({ success: true, id: 'notification-1', status: 'SENT' }),
      getLogs: jest.fn().mockResolvedValue([{ id: 'notification-1', status: 'SENT' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: service }],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('delega el envío al servicio', async () => {
    const dto = {
      channel: NotificationChannelDto.EMAIL,
      recipient: 'pasajero@ejemplo.com',
      subject: 'Actualización del viaje',
      content: 'Tu conductor está en camino.',
    };

    await expect(controller.send(dto)).resolves.toEqual({
      success: true,
      id: 'notification-1',
      status: 'SENT',
    });
    expect(service.send).toHaveBeenCalledWith(dto);
  });

  it('consulta el historial aplicando los filtros recibidos', async () => {
    const logs = await controller.getLogs('pasajero@ejemplo.com', 'SENT');

    expect(logs).toEqual([{ id: 'notification-1', status: 'SENT' }]);
    expect(service.getLogs).toHaveBeenCalledWith('pasajero@ejemplo.com', 'SENT');
  });
});
