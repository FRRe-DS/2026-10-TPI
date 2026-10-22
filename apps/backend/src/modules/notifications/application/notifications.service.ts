import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationStatus,
} from '@prisma/client';
import { SendNotificationDto } from './dto/send-notification.dto';
import { PrismaService } from '../../../common/prisma.service';
import * as nodemailer from 'nodemailer';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly prisma: PrismaService) {
    const host = process.env.SMTP_HOST || 'localhost';
    const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 1025;
    const user = process.env.SMTP_USER;
    const password = process.env.SMTP_PASS;

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('SMTP_PORT debe ser un puerto válido entre 1 y 65535.');
    }

    if (Boolean(user) !== Boolean(password)) {
      throw new Error('SMTP_USER y SMTP_PASS deben configurarse juntos.');
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true',
      ...(user && password ? { auth: { user, pass: password } } : {}),
    });
  }

  async send(dto: SendNotificationDto) {
    this.logger.log(`Enviando notificación [${dto.channel}] a: ${dto.recipient}`);

    let status: NotificationStatus = NotificationStatus.SENT;
    let errorMessage: string | null = null;

    if (dto.channel === 'EMAIL' && this.transporter) {
      try {
        await this.transporter.sendMail({
          from: process.env.SMTP_FROM || 'soporte@movilidadurbana.local',
          to: dto.recipient,
          subject: dto.subject,
          text: dto.content,
          html: `<div style="font-family: sans-serif; padding: 20px;">
                  <h2>${this.escapeHtml(dto.subject)}</h2>
                  <p>${this.escapeHtml(dto.content)}</p>
                  <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;"/>
                  <small style="color: #888;">Plataforma de Movilidad Urbana - Módulo 8 (G10)</small>
                </div>`,
        });
        this.logger.log(`Email enviado a ${dto.recipient}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Error enviando email: ${message}`);
        status = NotificationStatus.FAILED;
        errorMessage = message;
      }
    }

    try {
      const log = await this.prisma.notificationLog.create({
        data: {
          channel: NotificationChannel[dto.channel],
          recipient: dto.recipient,
          subject: dto.subject,
          content: dto.content,
          status,
          referenceId: dto.referenceId,
          referenceType: dto.referenceType,
          lastError: errorMessage,
        },
      });
      return {
        success: status === NotificationStatus.SENT,
        id: log.id,
        status,
      };
    } catch (dbErr) {
      const details =
        dbErr instanceof Error ? dbErr.message : String(dbErr);
      this.logger.error(
        `No se pudo guardar el intento de notificación en Supabase: ${details}`,
        dbErr instanceof Error ? dbErr.stack : undefined,
      );
      throw new InternalServerErrorException(
        'No se pudo registrar el intento de notificación.',
      );
    }
  }

  async getLogs(recipient?: string, status?: string) {
    try {
      return await this.prisma.notificationLog.findMany({
        where: {
          recipient: recipient ? { contains: recipient } : undefined,
          status: status ? (status as any) : undefined,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    } catch (e) {
      return [];
    }
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
