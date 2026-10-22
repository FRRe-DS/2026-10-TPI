import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NotificationsService } from '../../application/notifications.service';
import { NotificationsController } from './notifications.controller';

describe('NotificationsController Swagger documentation', () => {
  it('documents POST /notifications/send with its request and response schemas', async () => {
    const module = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: { send: jest.fn(), getLogs: jest.fn() },
        },
      ],
    }).compile();
    const app = module.createNestApplication();

    app.setGlobalPrefix('api/v1');
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Test API')
        .setVersion('1.0')
        .build(),
    );

    const sendOperation = Object.values(document.paths)
      .map((path) => path.post)
      .find((operation) =>
        operation?.tags?.includes('Notificaciones'),
      );

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
});
