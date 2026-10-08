import { Injectable, Logger } from '@nestjs/common';
import { SendNotificationDto } from './dto/send-notification.dto';
import { PrismaService } from '../../../common/prisma.service';
import * as nodemailer from 'nodemailer';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly prisma: PrismaService) {
    const host = process.env.SMTP_HOST || 'localhost';
    const port = Number(process.env.SMTP_PORT) || 1025;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
      ignoreTLS: true,
    });
  }

  async send(dto: SendNotificationDto) {
    this.logger.log(`Enviando notificación [${dto.channel}] a: ${dto.recipient}`);

    let status: 'SENT' | 'FAILED' = 'SENT';
    let errorMessage: string | null = null;

    if (dto.channel === 'EMAIL' && this.transporter) {
      try {
        await this.transporter.sendMail({
          from: process.env.SMTP_FROM || 'soporte@movilidadurbana.local',
          to: dto.recipient,
          subject: dto.subject,
          text: dto.content,
          html: `<div style="font-family: sans-serif; padding: 20px;">
                  <h2>${dto.subject}</h2>
                  <p>${dto.content}</p>
                  <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;"/>
                  <small style="color: #888;">Plataforma de Movilidad Urbana - Módulo 8 (G10)</small>
                </div>`,
        });
        this.logger.log(`Email enviado a ${dto.recipient}`);
      } catch (err) {
        this.logger.warn(`Error enviando email: ${err.message}`);
        status = 'FAILED';
        errorMessage = err.message;
      }
    }

    try {
      const log = await this.prisma.notificationLog.create({
        data: {
          channel: dto.channel as any,
          recipient: dto.recipient,
          subject: dto.subject,
          content: dto.content,
          status: status as any,
          referenceId: dto.referenceId,
          referenceType: dto.referenceType,
          lastError: errorMessage,
        },
      });
      return { success: status === 'SENT', id: log.id, status };
    } catch (dbErr) {
      this.logger.warn(`⚠ No se pudo registrar en base de datos: ${dbErr.message}`);
      return {
        success: status === 'SENT',
        id: 'mem-' + Date.now(),
        status,
        note: 'Procesado sin persistencia DB activa',
      };
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
}
