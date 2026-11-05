import { Test, TestingModule } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from '../../application/notifications.service';
import { NotificationChannelDto } from '../../application/dto/send-notification.dto';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: {
    send: jest.Mock;
    getLogs: jest.Mock;
    enviarUnificada: jest.Mock;
    listarPaginadas: jest.Mock;
    findById: jest.Mock;
    getIntentos: jest.Mock;
    retry: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      send: jest.fn().mockResolvedValue({ success: true, id: 'notification-1', status: 'SENT' }),
      getLogs: jest.fn().mockResolvedValue([{ id: 'notification-1', status: 'SENT' }]),
      enviarUnificada: jest.fn().mockResolvedValue({ notificacionId: 'notification-1', id: 'notification-1', estado: 'ENVIADA' }),
      listarPaginadas: jest.fn().mockResolvedValue({ page: 0, size: 20, totalElementos: 0, totalPaginas: 1, items: [] }),
      findById: jest.fn().mockResolvedValue({ notificacionId: 'notification-1', id: 'notification-1', estado: 'ENVIADA' }),
      getIntentos: jest.fn().mockResolvedValue({ page: 0, size: 20, totalElementos: 1, totalPaginas: 1, items: [{ numero: 1, resultado: 'EXITO' }] }),
      retry: jest.fn().mockResolvedValue({ notificacionId: 'notification-1', id: 'notification-1', estado: 'ENVIADA', intentos: 2 }),
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

  it('documents POST /notifications/send with its request and response schemas in Swagger', async () => {
    const module = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: service }],
    }).compile();
    const app = module.createNestApplication();

    app.setGlobalPrefix('api/v1');
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Test API').setVersion('1.0').build(),
    );

    const sendOperation = Object.values(document.paths)
      .map((path) => path.post)
      .find((operation) => operation?.tags?.includes('Notificaciones'));

    expect(sendOperation).toBeDefined();
    expect(sendOperation.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/SendNotificationDto' },
        },
      },
    });
    expect(sendOperation.responses).toEqual(
      expect.objectContaining({
        '201': expect.any(Object),
        '400': expect.any(Object),
        '500': expect.any(Object),
      }),
    );
    expect(document.components.schemas.SendNotificationDto).toBeDefined();

    await app.close();
  });

  it('delega las rutas canónicas del contrato coordinado (/notificaciones) al servicio', async () => {
    const resEnvio = await controller.enviarNotificacion({
      canal: NotificationChannelDto.EMAIL,
      destinatario: 'pasajero@ejemplo.com',
      asunto: 'Aviso',
      mensaje: 'Hola',
    });
    expect(resEnvio).toEqual({
      notificacionId: 'notification-1',
      id: 'notification-1',
      estado: 'ENVIADA',
    });

    const resLista = await controller.listarNotificaciones('usr-1', undefined, 'ENVIADA');
    expect(resLista.items).toEqual([]);

    const resDetalle = await controller.obtenerNotificacion('notification-1');
    expect(resDetalle.estado).toBe('ENVIADA');

    const resIntentos = await controller.listarIntentos('notification-1');
    expect(resIntentos.items[0].resultado).toBe('EXITO');

    const resReintento = await controller.reintentarNotificacion('notification-1');
    expect(resReintento.intentos).toBe(2);
  });
});
