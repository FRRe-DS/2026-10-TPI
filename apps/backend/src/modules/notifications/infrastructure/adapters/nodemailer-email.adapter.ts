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
      secure: process.env.SMTP_SECURE === 'true',
      ignoreTLS: process.env.SMTP_SECURE !== 'true',
      ...(process.env.SMTP_USER && process.env.SMTP_PASS
        ? {
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            },
          }
        : {}),
    });
  }

  async send(notification: NotificationMessage): Promise<void> {
    await this.transporter.sendMail({
      from: process.env.SMTP_FROM || 'soporte@movilidadurbana.local',
      to: notification.recipient,
      subject: notification.subject,
      text: notification.content,
      html: `<div style="font-family: sans-serif; padding: 20px;">
              <h2>${this.escapeHtml(notification.subject)}</h2>
              <p>${this.escapeHtml(notification.content)}</p>
              <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;"/>
              <small style="color: #888;">Plataforma de Movilidad Urbana - Módulo 8 (G10)</small>
            </div>`,
      attachments: notification.attachments?.map((att) => ({
        filename: att.filename,
        content: Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content),
        contentType: att.contentType || 'application/pdf',
      })),
      ...(notification.messageId ? { messageId: notification.messageId } : {}),
    });
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return entities[character];
    });
  }
}
