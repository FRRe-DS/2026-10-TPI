import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EnviarNotificacionUnificadaDto,
  NotificationChannelDto,
  SendNotificationDto,
} from './dto/send-notification.dto';
import { SendNotificationUseCase } from './use-cases/send-notification.use-case';
import {
  NotificationLogRecord,
  NotificationLogRepositoryPort,
  NotificationStatus,
} from '../domain/ports/notification-log.repository.port';

const STATUS_FROM_SPANISH: Record<string, NotificationStatus> = {
  PENDIENTE: 'PENDING',
  ENVIADA: 'SENT',
  FALLIDA: 'FAILED',
};

const STATUS_TO_SPANISH: Record<NotificationStatus, string> = {
  PENDING: 'PENDIENTE',
  SENT: 'ENVIADA',
  FAILED: 'FALLIDA',
};

const REF_TYPE_TO_SPANISH: Record<string, string> = {
  TRIP: 'VIAJE',
  VIAJE: 'VIAJE',
  RESERVATION: 'RESERVA',
  RESERVA: 'RESERVA',
  PAYMENT: 'PAGO',
  PAGO: 'PAGO',
};

const REF_TYPE_FROM_SPANISH: Record<string, string> = {
  VIAJE: 'TRIP',
  TRIP: 'TRIP',
  RESERVA: 'RESERVATION',
  RESERVATION: 'RESERVATION',
  PAGO: 'PAYMENT',
  PAYMENT: 'PAYMENT',
  OTRO: 'OTHER',
  OTHER: 'OTHER',
};

const isNotificationStatus = (status: string): status is NotificationStatus =>
  status === 'PENDING' || status === 'SENT' || status === 'FAILED';

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

  constructor(
    private readonly sendNotificationUseCase: SendNotificationUseCase,
    private readonly notificationLogRepository: NotificationLogRepositoryPort,
  ) {}

  async send(
    dto: SendNotificationDto,
    eventId?: string,
    retryPending = false,
  ): Promise<NotificationSendResult> {
    this.logger.log(`Enviando notificación [${dto.channel}] a: ${dto.recipient}`);
    return this.sendNotificationUseCase.execute(dto, eventId, retryPending);
  }

  async getLogs(recipient?: string, status?: string) {
    let notificationStatus: NotificationStatus | undefined;
    if (status) {
      const normalized = STATUS_FROM_SPANISH[status.toUpperCase()] ?? status;
      if (!isNotificationStatus(normalized)) {
        throw new BadRequestException(`Estado de notificación inválido: ${status}`);
      }
      notificationStatus = normalized;
    }

    return this.notificationLogRepository.findMany({
      recipient,
      status: notificationStatus,
    });
  }

  // ─── Métodos Canónicos del Contrato Coordinado Definitivo (G10 + G7) ────────

  async enviarUnificada(dto: EnviarNotificacionUnificadaDto) {
    const channel = dto.canal ?? dto.channel ?? NotificationChannelDto.EMAIL;
    const rawRecipient = dto.recipient ?? dto.destinatario ?? dto.destinatarioId ?? '';
    const subject = dto.asunto ?? dto.subject ?? '';
    const content = dto.mensaje ?? dto.content ?? '';

    if (!rawRecipient.trim() || !subject.trim() || !content.trim()) {
      throw new BadRequestException(
        'Los campos destinatarioId/recipient, asunto/subject y mensaje/content son obligatorios.',
      );
    }

    const recipient =
      channel === NotificationChannelDto.EMAIL && !rawRecipient.includes('@')
        ? `${rawRecipient}@notificaciones.m8.local`
        : rawRecipient;

    const rawRefType = dto.referencia?.tipo ?? dto.referenceType;
    const referenceType = rawRefType
      ? (REF_TYPE_FROM_SPANISH[rawRefType.toUpperCase()] ?? rawRefType)
      : undefined;
    const referenceId = dto.referencia?.id ?? dto.referenceId;

    const result = await this.send({
      channel,
      recipient,
      subject,
      content,
      referenceId,
      referenceType,
    });

    const now = new Date().toISOString();
    return {
      notificacionId: result.id,
      id: result.id,
      destinatarioId: dto.destinatarioId ?? rawRecipient,
      canal: channel,
      asunto: subject,
      mensaje: content,
      estado: STATUS_TO_SPANISH[result.status] ?? result.status,
      status: result.status,
      success: result.success,
      intentos: 1,
      ...(referenceId
        ? {
            referencia: {
              tipo: REF_TYPE_TO_SPANISH[referenceType ?? ''] ?? referenceType ?? 'VIAJE',
              id: referenceId,
            },
          }
        : {}),
      creadoEn: now,
      ...(result.status === 'SENT' ? { enviadoEn: now } : {}),
    };
  }

  async listarPaginadas(params: {
    recipient?: string;
    status?: string;
    canal?: string;
    referenciaId?: string;
    page?: number;
    size?: number;
  }) {
    const page = Math.max(0, Number(params.page ?? 0) || 0);
    const size = Math.min(100, Math.max(1, Number(params.size ?? 20) || 20));
    let logs = await this.getLogs(params.recipient, params.status);

    if (params.canal) {
      const targetChannel = params.canal.toUpperCase();
      logs = logs.filter((log) => log.channel?.toUpperCase() === targetChannel);
    }
    if (params.referenciaId) {
      logs = logs.filter((log) => log.referenceId === params.referenciaId);
    }

    const totalElementos = logs.length;
    const totalPaginas = Math.max(1, Math.ceil(totalElementos / size));
    const slice = logs.slice(page * size, page * size + size);
    const mapped = slice.map((log) => this.toUnifiedNotification(log));

    return {
      page,
      size,
      totalElementos,
      totalPaginas,
      items: mapped,
      elementos: mapped,
    };
  }

  async findById(notificacionId: string) {
    const log = await this.findRawLogById(notificacionId);
    return this.toUnifiedNotification(log);
  }

  async getIntentos(notificacionId: string, page = 0, size = 20) {
    const log = await this.findRawLogById(notificacionId);
    const totalAttempts = Math.max(1, (log.retryCount ?? 0) + 1);
    const intentos = Array.from({ length: totalAttempts }, (_, idx) => {
      const isLast = idx === totalAttempts - 1;
      const resultado = isLast && log.status === 'SENT' ? 'EXITO' : 'ERROR';
      return {
        numero: idx + 1,
        canal: log.channel,
        resultado,
        ...(resultado === 'ERROR' && log.lastError ? { error: log.lastError } : {}),
        realizadoEn: (log.updatedAt ?? log.createdAt ?? new Date()).toISOString(),
      };
    });

    return {
      page,
      size,
      totalElementos: intentos.length,
      totalPaginas: 1,
      items: intentos,
      elementos: intentos,
    };
  }

  async retry(notificacionId: string) {
    const log = await this.findRawLogById(notificacionId);
    if (log.status !== 'FAILED') {
      throw new ConflictException({
        type: '/errores/notificacion-no-fallida',
        title: 'Solo se puede reintentar una notificación en estado FALLIDA',
        detail: `La notificación "${notificacionId}" se encuentra en estado ${STATUS_TO_SPANISH[log.status] ?? log.status} y no admite reintento manual.`,
      });
    }

    const result = await this.send(
      {
        channel: log.channel as NotificationChannelDto,
        recipient: log.recipient,
        subject: log.subject,
        content: log.content,
        referenceId: log.referenceId,
        referenceType: log.referenceType,
      },
      log.eventId ?? undefined,
      true,
    );

    return this.toUnifiedNotification({
      ...log,
      status: result.status,
      retryCount: (log.retryCount ?? 0) + 1,
      updatedAt: new Date(),
    });
  }

  private async findRawLogById(notificacionId: string): Promise<NotificationLogRecord> {
    let log: NotificationLogRecord | null = null;
    if (this.notificationLogRepository.findById) {
      log = await this.notificationLogRepository.findById(notificacionId);
    } else {
      const all = await this.notificationLogRepository.findMany();
      log = all.find((item) => item.id === notificacionId) ?? null;
    }

    if (!log) {
      throw new NotFoundException(`Notificación "${notificacionId}" no encontrada.`);
    }
    return log;
  }

  private toUnifiedNotification(log: NotificationLogRecord) {
    const createdIso =
      log.createdAt instanceof Date
        ? log.createdAt.toISOString()
        : new Date().toISOString();
    const updatedIso =
      log.updatedAt instanceof Date
        ? log.updatedAt.toISOString()
        : createdIso;

    return {
      notificacionId: log.id,
      id: log.id,
      ...(log.eventId ? { eventoId: log.eventId } : {}),
      destinatarioId: log.recipient,
      recipient: log.recipient,
      canal: log.channel,
      channel: log.channel,
      asunto: log.subject,
      subject: log.subject,
      estado: STATUS_TO_SPANISH[log.status] ?? log.status,
      status: log.status,
      intentos: (log.retryCount ?? 0) + 1,
      retryCount: log.retryCount ?? 0,
      ...(log.referenceId
        ? {
            referencia: {
              tipo:
                REF_TYPE_TO_SPANISH[log.referenceType ?? ''] ??
                log.referenceType ??
                'VIAJE',
              id: log.referenceId,
            },
            referenceId: log.referenceId,
            referenceType: log.referenceType,
          }
        : {}),
      creadoEn: createdIso,
      createdAt: createdIso,
      ...(log.status === 'SENT' ? { enviadoEn: updatedIso } : {}),
      ...(log.lastError ? { ultimoError: log.lastError } : {}),
    };
  }
}
