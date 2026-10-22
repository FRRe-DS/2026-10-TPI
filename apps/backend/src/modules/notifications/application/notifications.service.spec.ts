import * as nodemailer from 'nodemailer';
import { InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma.service';
import {
  NotificationChannelDto,
  SendNotificationDto,
} from './dto/send-notification.dto';
import { NotificationsService } from './notifications.service';
import { NotificationStatus } from '@prisma/client';

describe('NotificationsService email delivery', () => {
  const smtpVariables = [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM',
  ];
  let originalEnvironment: Record<string, string | undefined>;
  let sendMail: jest.Mock;
  let createTransport: jest.SpyInstance;
  let createNotificationLog: jest.Mock;
  let findNotificationLog: jest.Mock;
  let claimNotificationLog: jest.Mock;
  let findNotificationLogById: jest.Mock;
  let updateNotificationLog: jest.Mock;
  let service: NotificationsService;

  const notification: SendNotificationDto = {
    channel: NotificationChannelDto.EMAIL,
    recipient: 'pasajero@ejemplo.com',
    subject: 'Tu conductor está en camino',
    content: 'El conductor llegará en 3 minutos.',
  };

  beforeEach(() => {
    originalEnvironment = Object.fromEntries(
      smtpVariables.map((name) => [name, process.env[name]]),
    );
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_USER = 'mailer';
    process.env.SMTP_PASS = 'secret';
    process.env.SMTP_FROM = 'soporte@ejemplo.com';

    sendMail = jest.fn().mockResolvedValue({ messageId: 'email-1' });
    createTransport = jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail } as unknown as nodemailer.Transporter);
    createNotificationLog = jest
      .fn()
      .mockResolvedValue({
        id: 'notification-1',
        status: NotificationStatus.PENDING,
      });
    findNotificationLog = jest.fn().mockResolvedValue(null);
    claimNotificationLog = jest.fn().mockResolvedValue({ count: 1 });
    findNotificationLogById = jest.fn();
    updateNotificationLog = jest.fn().mockResolvedValue({
      id: 'notification-1',
      status: NotificationStatus.SENT,
    });
    service = new NotificationsService({
      notificationLog: {
        create: createNotificationLog,
        findUnique: findNotificationLog,
        updateMany: claimNotificationLog,
        findUniqueOrThrow: findNotificationLogById,
        update: updateNotificationLog,
      },
    } as unknown as PrismaService);
  });

  afterEach(() => {
    createTransport.mockRestore();
    smtpVariables.forEach((name) => {
      const value = originalEnvironment[name];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  });

  it('configures Nodemailer from SMTP environment variables and sends an email', async () => {
    const result = await service.send(
      {
        ...notification,
        subject: '<b>Alerta</b>',
        content: 'Usa <img src=x onerror=alert(1)>',
      },
      'event-1',
    );

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'mailer', pass: 'secret' },
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'soporte@ejemplo.com',
        to: 'pasajero@ejemplo.com',
        subject: '<b>Alerta</b>',
        text: 'Usa <img src=x onerror=alert(1)>',
        html: expect.stringContaining('&lt;b&gt;Alerta&lt;/b&gt;'),
        messageId: '<event-1@movilidadurbana.local>',
      }),
    );
    expect(sendMail.mock.calls[0][0].html).toContain(
      'Usa &lt;img src=x onerror=alert(1)&gt;',
    );
    expect(result).toEqual({
      success: true,
      id: 'notification-1',
      status: 'SENT',
    });
    expect(createNotificationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          recipient: 'pasajero@ejemplo.com',
          eventId: 'event-1',
        }),
      }),
    );
    expect(updateNotificationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notification-1' },
        data: { status: 'SENT', lastError: null },
      }),
    );
  });

  it('records SMTP delivery failures instead of reporting success', async () => {
    sendMail.mockRejectedValue(new Error('SMTP unavailable'));

    const result = await service.send(notification);

    expect(result).toEqual({
      success: false,
      id: 'notification-1',
      status: 'FAILED',
      retryable: true,
    });
    expect(createNotificationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
        }),
      }),
    );
    expect(updateNotificationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          lastError: 'SMTP unavailable',
          retryCount: { increment: 1 },
        }),
      }),
    );
  });

  it('reports a database error instead of returning a success-shaped fallback', async () => {
    createNotificationLog.mockRejectedValue(new Error('Database unavailable'));

    await expect(service.send(notification)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(createNotificationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          recipient: 'pasajero@ejemplo.com',
        }),
      }),
    );
  });

  it('rejects incomplete SMTP authentication configuration', () => {
    delete process.env.SMTP_PASS;

    expect(
      () =>
        new NotificationsService({
          notificationLog: {
            create: createNotificationLog,
            findUnique: findNotificationLog,
            updateMany: claimNotificationLog,
            findUniqueOrThrow: findNotificationLogById,
            update: updateNotificationLog,
          },
        } as unknown as PrismaService),
    ).toThrow('SMTP_USER y SMTP_PASS deben configurarse juntos.');
  });

  it('does not send an event again after its idempotency key is marked SENT', async () => {
    findNotificationLog.mockResolvedValue({
      id: 'notification-1',
      status: NotificationStatus.SENT,
    });

    const result = await service.send(notification, 'event-1');

    expect(sendMail).not.toHaveBeenCalled();
    expect(createNotificationLog).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      id: 'notification-1',
      status: 'SENT',
      duplicate: true,
      retryable: false,
    });
  });

  it('does not race a notification already in progress for the same event', async () => {
    findNotificationLog.mockResolvedValue({
      id: 'notification-1',
      status: NotificationStatus.PENDING,
    });

    const result = await service.send(notification, 'event-1');

    expect(sendMail).not.toHaveBeenCalled();
    expect(claimNotificationLog).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      id: 'notification-1',
      status: 'PENDING',
      duplicate: true,
      retryable: true,
    });
  });

  it('retries a previously FAILED event with the same log and stable message id', async () => {
    findNotificationLog.mockResolvedValue({
      id: 'notification-1',
      status: NotificationStatus.FAILED,
    });

    await service.send(notification, 'event-1', true);

    expect(claimNotificationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'notification-1',
          status: NotificationStatus.FAILED,
        },
        data: {
          status: NotificationStatus.PENDING,
          lastError: null,
        },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: '<event-1@movilidadurbana.local>',
      }),
    );
    expect(createNotificationLog).not.toHaveBeenCalled();
  });

  it('records SMS as FAILED rather than claiming delivery without an SMS provider', async () => {
    const result = await service.send({
      ...notification,
      channel: NotificationChannelDto.SMS,
      recipient: '+5491112345678',
    });

    expect(sendMail).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      status: 'FAILED',
      retryable: false,
    });
    expect(updateNotificationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: NotificationStatus.FAILED,
          lastError: 'No hay un proveedor configurado para el canal SMS.',
        },
      }),
    );
  });
});
