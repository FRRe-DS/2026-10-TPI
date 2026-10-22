import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import {
  NotificationMessage,
  NotificationSenderPort,
} from '../../domain/ports/notification-sender.port';

@Injectable()
export class NodemailerEmailAdapter extends NotificationSenderPort {
  private readonly transporter: nodemailer.Transporter;

  constructor() {
    super();
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: Number(process.env.SMTP_PORT) || 1025,
      secure: false,
      ignoreTLS: true,
    });
  }

  async send(notification: NotificationMessage): Promise<void> {
    await this.transporter.sendMail({
      from: process.env.SMTP_FROM || 'soporte@movilidadurbana.local',
      to: notification.recipient,
      subject: notification.subject,
      text: notification.content,
      html: `<div style="font-family: sans-serif; padding: 20px;">
              <h2>${notification.subject}</h2>
              <p>${notification.content}</p>
              <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;"/>
              <small style="color: #888;">Plataforma de Movilidad Urbana - Módulo 8 (G10)</small>
            </div>`,
    });
  }
}
