import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  NotificationChannel,
  NotificationStatus,
} from '@prisma/client';
import { SendNotificationDto } from './dto/send-notification.dto';
import { PrismaService } from '../../../common/prisma.service';
import * as nodemailer from 'nodemailer';

export interface NotificationSendResult {
  success: boolean;
  id: string;
  status: NotificationStatus;
  duplicate?: boolean;
  retryable?: boolean;
}

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

  async send(
    dto: SendNotificationDto,
    eventId?: string,
    retryPending = false,
  ): Promise<NotificationSendResult> {
    this.logger.log(`Enviando notificación [${dto.channel}] a: ${dto.recipient}`);

    const log = await this.prepareLog(dto, eventId, retryPending);
    if (!log.shouldSend) {
      return {
        success: log.status === NotificationStatus.SENT,
        id: log.id,
        status: log.status,
        duplicate: true,
        retryable: log.status !== NotificationStatus.SENT,
      };
    }

    if (dto.channel !== 'EMAIL') {
      const message = `No hay un proveedor configurado para el canal ${dto.channel}.`;
      await this.updateLog(log.id, {
        status: NotificationStatus.FAILED,
        lastError: message,
      });
      return {
        success: false,
        id: log.id,
        status: NotificationStatus.FAILED,
        retryable: false,
      };
    }

    let deliveryError: string | null = null;
    let deliveryFailed = false;
    try {
      await this.transporter!.sendMail({
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
        ...(eventId
          ? { messageId: `<${this.escapeMessageId(eventId)}@movilidadurbana.local>` }
          : {}),
      });
    } catch (err) {
      deliveryFailed = true;
      deliveryError =
        err instanceof Error && err.message
          ? err.message
          : 'El proveedor SMTP rechazó el envío.';
    }

    if (deliveryFailed) {
      this.logger.warn(`Error enviando email: ${deliveryError}`);
      await this.updateLog(log.id, {
        status: NotificationStatus.FAILED,
        lastError: deliveryError,
        retryCount: { increment: 1 },
      });
      return {
        success: false,
        id: log.id,
        status: NotificationStatus.FAILED,
        retryable: true,
      };
    }

    await this.updateLog(log.id, {
      status: NotificationStatus.SENT,
      lastError: null,
    });
    this.logger.log(`Email enviado a ${dto.recipient}`);
    return {
      success: true,
      id: log.id,
      status: NotificationStatus.SENT,
    };
  }

  private async prepareLog(
    dto: SendNotificationDto,
    eventId?: string,
    retryPending = false,
  ): Promise<{ id: string; status: NotificationStatus; shouldSend: boolean }> {
    try {
      if (eventId) {
        const existing = await this.prisma.notificationLog.findUnique({
          where: { eventId },
        });
        if (existing) {
          if (existing.status === NotificationStatus.SENT) {
            return { id: existing.id, status: existing.status, shouldSend: false };
          }

          if (
            existing.status === NotificationStatus.PENDING &&
            !retryPending
          ) {
            return { id: existing.id, status: existing.status, shouldSend: false };
          }

          const claim = await this.prisma.notificationLog.updateMany({
            where: {
              id: existing.id,
              status: existing.status,
            },
            data: {
              status: NotificationStatus.PENDING,
              lastError: null,
            },
          });
          if (claim.count === 1) {
            return {
              id: existing.id,
              status: NotificationStatus.PENDING,
              shouldSend: true,
            };
          }

          const current = await this.prisma.notificationLog.findUniqueOrThrow({
            where: { id: existing.id },
          });
          return {
            id: current.id,
            status: current.status,
            shouldSend: false,
          };
        }
      }

      const created = await this.prisma.notificationLog.create({
        data: {
          ...(eventId ? { eventId } : {}),
          channel: NotificationChannel[dto.channel],
          recipient: dto.recipient,
          subject: dto.subject,
          content: dto.content,
          status: NotificationStatus.PENDING,
          referenceId: dto.referenceId,
          referenceType: dto.referenceType,
        },
      });
      return { id: created.id, status: created.status, shouldSend: true };
    } catch (dbErr) {
      if (eventId && this.isUniqueConstraintError(dbErr)) {
        const existing = await this.prisma.notificationLog.findUnique({
          where: { eventId },
        });
        if (existing) {
          return {
            id: existing.id,
            status: existing.status,
            shouldSend: false,
          };
        }
      }

      const details =
        dbErr instanceof Error ? dbErr.message : String(dbErr);
      this.logger.error(
        `No se pudo preparar el registro de notificación en Supabase: ${details}`,
        dbErr instanceof Error ? dbErr.stack : undefined,
      );
      throw new InternalServerErrorException(
        'No se pudo registrar el intento de notificación.',
      );
    }
  }

  private async updateLog(
    id: string,
    data: {
      status: NotificationStatus;
      lastError: string | null;
      retryCount?: { increment: number };
    },
  ): Promise<void> {
    try {
      await this.prisma.notificationLog.update({ where: { id }, data });
    } catch (dbErr) {
      const details =
        dbErr instanceof Error ? dbErr.message : String(dbErr);
      this.logger.error(
        `No se pudo actualizar el registro de notificación en Supabase: ${details}`,
        dbErr instanceof Error ? dbErr.stack : undefined,
      );
      throw new InternalServerErrorException(
        'No se pudo actualizar el intento de notificación.',
      );
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
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

  private escapeMessageId(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
}
