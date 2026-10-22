import * as nodemailer from 'nodemailer';
import { InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma.service';
import {
  NotificationChannelDto,
  SendNotificationDto,
} from './dto/send-notification.dto';
import { NotificationsService } from './notifications.service';

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
      .mockResolvedValue({ id: 'notification-1' });
    service = new NotificationsService({
      notificationLog: { create: createNotificationLog },
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
    const result = await service.send({
      ...notification,
      subject: '<b>Alerta</b>',
      content: 'Usa <img src=x onerror=alert(1)>',
    });

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
          status: 'SENT',
          recipient: 'pasajero@ejemplo.com',
        }),
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
    });
    expect(createNotificationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          lastError: 'SMTP unavailable',
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
          status: 'SENT',
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
          notificationLog: { create: createNotificationLog },
        } as unknown as PrismaService),
    ).toThrow('SMTP_USER y SMTP_PASS deben configurarse juntos.');
  });
});
