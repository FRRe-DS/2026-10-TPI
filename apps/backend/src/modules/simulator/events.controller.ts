import {
  BadRequestException,
  Body,
  Controller,

  HttpCode,
  HttpStatus,
  Logger,
  Optional,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { NotificationsService } from '../notifications/application/notifications.service';
import { NotificationChannelDto } from '../notifications/application/dto/send-notification.dto';
import {
  IssuedReceipt,
  IssueReceiptUseCase,
} from '../documents/application/use-cases/issue-receipt.use-case';
import { RedisService } from '../../common/redis.service';
import {
  checkIdempotency,

  saveIdempotency,
} from '../../common/contract-security.util';
import * as crypto from 'crypto';
import { Roles } from '../../common/auth';

export class DestinatarioEventoDto {
  @ApiProperty({ example: 'usr-uuid-3003' })
  @IsString()
  @IsNotEmpty()
  usuarioId: string;

  @ApiProperty({ required: false, example: 'CLIENTE', enum: ['CLIENTE', 'CONDUCTOR'] })
  @IsString()
  @IsOptional()
  rol?: string;

  @ApiProperty({ required: false, example: 'pasajero@ejemplo.com' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiProperty({ required: false, example: '+5493624000000' })
  @IsString()
  @IsOptional()
  telefono?: string;

  @ApiProperty({ required: false, example: ['EMAIL'] })
  @IsArray()
  @IsOptional()
  canalesPreferidos?: string[];
}

export class ImporteEventoDto {
  @ApiProperty({ example: 4200 })
  @IsNumber()
  @IsOptional()
  monto?: number;

  @ApiProperty({ required: false, example: 'ARS', default: 'ARS' })
  @IsString()
  @IsOptional()
  moneda?: string;
}

export class DetalleEventoDto {
  @ApiProperty({ required: false, example: 'Av. 9 de Julio 1200' })
  @IsString()
  @IsOptional()
  origen?: string;

  @ApiProperty({ required: false, example: 'UTN FRRe - French 414' })
  @IsString()
  @IsOptional()
  destino?: string;

  @ApiProperty({ required: false, example: '2026-10-28T14:00:00Z' })
  @IsString()
  @IsOptional()
  fechaProgramada?: string;

  @ApiProperty({ required: false, example: 'America/Argentina/Buenos_Aires' })
  @IsString()
  @IsOptional()
  zonaHoraria?: string;

  @ApiProperty({ required: false, example: 'AUTO', enum: ['AUTO', 'MOTO'] })
  @IsString()
  @IsOptional()
  tipoVehiculo?: string;

  @ApiProperty({ required: false, example: 'Conductor asignado' })
  @IsString()
  @IsOptional()
  motivo?: string;

  @ApiProperty({ required: false, type: ImporteEventoDto })
  @IsOptional()
  importe?: ImporteEventoDto;
}

export class EventoEntradaDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Identificador único del evento (clave de idempotencia)',
  })
  @IsString()
  @IsNotEmpty()
  eventoId: string;

  @ApiProperty({
    example: 'VIAJE_FINALIZADO',
    description: 'Tipo de hito de viaje, reserva o pago',
  })
  @IsString()
  @IsNotEmpty()
  tipo: string;

  @ApiProperty({
    example: 'M6',
    enum: ['M5', 'M6', 'M7', 'M9'],
    description: 'Módulo emisor del evento',
  })
  @IsString()
  @IsNotEmpty()
  origen: string;

  @ApiProperty({ example: '2026-10-27T15:30:00.000Z' })
  @IsString()
  @IsNotEmpty()
  ocurridoEn: string;

  @ApiProperty({ required: false, example: 'trip-uuid-1001' })
  @IsString()
  @IsOptional()
  viajeId?: string;

  @ApiProperty({ required: false, example: 'res-uuid-2001' })
  @IsString()
  @IsOptional()
  reservaId?: string;

  @ApiProperty({ required: false, example: 'pay-uuid-3001' })
  @IsString()
  @IsOptional()
  pagoId?: string;

  @ApiProperty({ type: [DestinatarioEventoDto] })
  @IsArray()
  destinatarios: DestinatarioEventoDto[];

  @ApiProperty({ required: false, type: DetalleEventoDto })
  @IsOptional()
  detalle?: DetalleEventoDto;
}

interface ProcessedEventRecord {
  bodyHash: string;
  response: {
    eventoId: string;
    recibidoEn: string;
  };
}

const EVENT_SUBJECTS: Record<string, string> = {
  VIAJE_SOLICITADO: 'Solicitud de viaje recibida',
  VIAJE_ASIGNADO: 'Conductor asignado a tu viaje',
  VIAJE_ARRIBO_CONDUCTOR: 'Tu conductor ha llegado al punto de encuentro',
  VIAJE_CONDUCTOR_LLEGA: 'Tu conductor ha llegado al punto de encuentro',
  VIAJE_INICIADO: 'Tu viaje ha comenzado',
  VIAJE_EN_CURSO: 'Tu viaje está en curso',
  VIAJE_FINALIZADO: '¡Viaje finalizado! Comprobante disponible',
  VIAJE_CANCELADO: 'Viaje cancelado',
  RESERVA_CREADA: 'Reserva de viaje registrada',
  RESERVA_MODIFICADA: 'Reserva de viaje modificada',
  RESERVA_CONFIRMADA: 'Reserva de viaje confirmada',
  RESERVA_RECORDATORIO: 'Recordatorio de tu reserva programada',
  RESERVA_ACTIVADA: 'Tu reserva programada fue activada en despacho',
  RESERVA_CANCELADA: 'Reserva cancelada',
  RESERVA_VENCIDA: 'Reserva vencida sin disponibilidad',
  PAGO_CAPTURADO: 'Confirmación de pago recibido',
  REINTEGRO_REGISTRADO: 'Reintegro procesado a tu favor',
};

@ApiTags('Eventos')
@ApiBearerAuth()
@Controller(['eventos', 'events'])
export class EventsController {
  private readonly logger = new Logger(EventsController.name);
  private readonly processedEvents = new Map<string, { hash: string; response: any }>();
  private readonly completedMilestones = new Set<string>();
  private readonly receiptPdfDeliveredTrips = new Set<string>();

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly issueReceiptUseCase: IssueReceiptUseCase,
    @Optional() private readonly redis?: RedisService,
  ) {}

  @Post()
  @Roles('SERVICIO')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Informar un hito de viaje, reserva o pago (RF-8.1, RF-8.2, RF-8.8)',
    description:
      'M5, M6, M7 y M9 informan acá cada hito. M8 lo registra con idempotencia por eventoId y responde 202 Accepted.',
  })
  @ApiBody({ type: EventoEntradaDto })
  @ApiResponse({ status: 202, description: 'Evento recibido. Se procesa de forma asíncrona.' })
  @ApiResponse({ status: 400, description: 'Solicitud inválida (falta referencia o destinatarios)' })
  @ApiResponse({ status: 401, description: 'No autenticado (token ausente, expirado o firma inválida)' })
  @ApiResponse({ status: 403, description: 'Sin permiso (se requiere rol SERVICIO)' })
  @ApiResponse({ status: 422, description: 'Conflicto de idempotencia (mismo eventoId con cuerpo distinto)' })
  async recibirEvento(
    @Body() dto: EventoEntradaDto,

  ) {

    if (!dto.eventoId || !dto.tipo || !dto.origen || !dto.ocurridoEn) {
      throw new BadRequestException(
        'Los campos eventoId, tipo, origen y ocurridoEn son obligatorios.',
      );
    }

    if (!dto.viajeId && !dto.reservaId && !dto.pagoId) {
      throw new BadRequestException(
        'El evento debe incluir al menos uno de los identificadores: viajeId, reservaId o pagoId.',
      );
    }

    if (!Array.isArray(dto.destinatarios) || dto.destinatarios.length === 0) {
      throw new BadRequestException(
        'El evento debe especificar al menos un destinatario.',
      );
    }

    // Control de idempotencia por eventoId respaldado en Redis + memoria (RNF-09)
    const bodyHash = this.computePayloadHash(dto);
    const cached = await checkIdempotency(
      this.processedEvents,
      this.redis,
      'evento',
      dto.eventoId,
      bodyHash,
    );
    if (cached) {
      this.logger.log(`[EVENTOS] Evento idempotente repetido: ${dto.eventoId}`);
      return cached;
    }

    const recibidoEn = new Date().toISOString();
    const response = {
      eventoId: dto.eventoId,
      recibidoEn,
    };

    // 1. Evitar repetir un mismo aviso terminal si el emisor reenvía el mismo hito con otro eventoId
    const tipoUpper = dto.tipo.toUpperCase();
    const milestoneKey = this.resolveTerminalMilestoneKey(tipoUpper, dto);
    if (milestoneKey && (await this.isMilestoneAlreadyProcessed(milestoneKey))) {
      this.logger.log(
        `[EVENTOS] Hito terminal ya procesado (${milestoneKey}); se omite aviso repetido para evento ${dto.eventoId}`,
      );
      await saveIdempotency(
        this.processedEvents,
        this.redis,
        'evento',
        dto.eventoId,
        bodyHash,
        response,
      );
      return response;
    }

    // 2. Si el evento implica emisión de comprobante (RF-8.4)
    const emitsReceipt =
      tipoUpper === 'VIAJE_FINALIZADO' ||
      tipoUpper === 'PAGO_CAPTURADO' ||
      tipoUpper === 'REINTEGRO_REGISTRADO';

    const tripIdForReceipt = dto.viajeId ?? dto.pagoId;
    const hasExplicitAmount =
      typeof dto.detalle?.importe?.monto === 'number' && dto.detalle.importe.monto > 0;
    // Según contrato: VIAJE_FINALIZADO dispara el comprobante cuando informa el importe; si M6
    // no envía importe, no se inventa un monto falso y lo emitirá PAGO_CAPTURADO desde M7.
    const shouldIssueReceipt =
      emitsReceipt &&
      Boolean(tripIdForReceipt) &&
      (tipoUpper !== 'VIAJE_FINALIZADO' || hasExplicitAmount);

    let issued: IssuedReceipt | undefined;
    let clienteDest: DestinatarioEventoDto | undefined;
    let pdfAlreadyDeliveredForTrip = false;

    if (shouldIssueReceipt && tripIdForReceipt) {
      clienteDest =
        dto.destinatarios.find((d) => d.rol?.toUpperCase() === 'CLIENTE') ??
        dto.destinatarios[0];
      const passengerId = clienteDest?.usuarioId || `usr-${tripIdForReceipt}`;
      const passengerEmail =
        clienteDest?.email || `${passengerId}@notificaciones.m8.local`;
      const amount = hasExplicitAmount ? dto.detalle!.importe!.monto! : 3500;
      const currency = dto.detalle?.importe?.moneda || 'ARS';

      pdfAlreadyDeliveredForTrip = await this.wasReceiptPdfDelivered(tripIdForReceipt);

      // Emisión automática: registra (idempotente) y genera el PDF como consecuencia del
      // hito. Si el PDF falla, el comprobante queda registrado y el evento sigue su curso.
      issued = await this.issueReceiptUseCase.execute({
        tripId: tripIdForReceipt,
        passengerId,
        passengerEmail,
        amount,
        currency,
      });
      if (!issued.pdf) {
        this.logger.warn(
          `[EVENTOS] Comprobante ${issued.receipt.receiptCode} registrado sin PDF generado: ${issued.pdfError}`,
        );
      }
    }

    // 3. Despachar notificaciones multicanal a cada destinatario sin repetir al mismo contacto (RF-8.1, RF-8.2)
    const referenceId = dto.viajeId ?? dto.reservaId ?? dto.pagoId;
    const referenceType = dto.viajeId
      ? 'TRIP'
      : dto.reservaId
        ? 'RESERVATION'
        : 'PAYMENT';
    const subject =
      EVENT_SUBJECTS[tipoUpper] ?? `Notificación de ${dto.tipo} (${dto.origen})`;
    const content = this.buildEventMessage(dto);

    const notifiedTargets = new Set<string>();
    for (let i = 0; i < dto.destinatarios.length; i++) {
      const dest = dto.destinatarios[i];
      const preferred = dest.canalesPreferidos?.[0]?.toUpperCase();
      const channel =
        preferred === 'SMS'
          ? NotificationChannelDto.SMS
          : preferred === 'PUSH'
            ? NotificationChannelDto.PUSH
            : NotificationChannelDto.EMAIL;

      const recipient =
        channel === NotificationChannelDto.EMAIL
          ? dest.email || `${dest.usuarioId}@notificaciones.m8.local`
          : channel === NotificationChannelDto.SMS
            ? dest.telefono || dest.usuarioId
            : dest.usuarioId;

      const targetKey = `${channel}:${recipient.toLowerCase()}`;
      if (notifiedTargets.has(targetKey)) {
        continue;
      }
      notifiedTargets.add(targetKey);

      const perRecipientEventId =
        dto.destinatarios.length === 1 ? dto.eventoId : `${dto.eventoId}:${i}`;

      const shouldAttachPdf =
        Boolean(issued?.pdf) &&
        !pdfAlreadyDeliveredForTrip &&
        channel === NotificationChannelDto.EMAIL &&
        dest === clienteDest &&
        dest.rol?.toUpperCase() !== 'CONDUCTOR';

      const sendResult = await this.notificationsService.send(
        {
          channel,
          recipient,
          subject,
          content,
          referenceId,
          referenceType,
          ...(shouldAttachPdf && issued?.pdf
            ? {
                attachments: [
                  {
                    filename: `comprobante-${issued.receipt.receiptCode}.pdf`,
                    content: issued.pdf,
                    contentType: 'application/pdf',
                  },
                ],
              }
            : {}),
        },
        perRecipientEventId,
      );

      if (shouldAttachPdf && sendResult?.success && tripIdForReceipt) {
        await this.markReceiptPdfDelivered(tripIdForReceipt);
        pdfAlreadyDeliveredForTrip = true;
      }
    }

    if (milestoneKey) {
      await this.markMilestoneProcessed(milestoneKey);
    }

    await saveIdempotency(
      this.processedEvents,
      this.redis,
      'evento',
      dto.eventoId,
      bodyHash,
      response,
    );
    this.logger.log(`[EVENTOS] Hito ${dto.tipo} (${dto.eventoId}) procesado desde ${dto.origen}`);

    return response;
  }

  private resolveTerminalMilestoneKey(tipoUpper: string, dto: EventoEntradaDto): string | null {
    if (tipoUpper === 'VIAJE_FINALIZADO' && dto.viajeId) {
      return `VIAJE_FINALIZADO:${dto.viajeId}`;
    }
    if (tipoUpper === 'VIAJE_CANCELADO' && dto.viajeId) {
      return `VIAJE_CANCELADO:${dto.viajeId}`;
    }
    if (tipoUpper === 'PAGO_CAPTURADO' && (dto.pagoId ?? dto.viajeId)) {
      return `PAGO_CAPTURADO:${dto.pagoId ?? dto.viajeId}`;
    }
    if (tipoUpper === 'REINTEGRO_REGISTRADO' && (dto.pagoId ?? dto.viajeId)) {
      return `REINTEGRO_REGISTRADO:${dto.pagoId ?? dto.viajeId}`;
    }
    return null;
  }

  private async isMilestoneAlreadyProcessed(key: string): Promise<boolean> {
    if (this.completedMilestones.has(key)) return true;
    if (this.redis) {
      const cached = await this.redis.get(`evento:milestone:${key}`).catch(() => null);
      if (cached) return true;
    }
    return false;
  }

  private async markMilestoneProcessed(key: string): Promise<void> {
    this.completedMilestones.add(key);
    if (this.redis) {
      await this.redis.set(`evento:milestone:${key}`, '1', 86400).catch(() => undefined);
    }
  }

  private async wasReceiptPdfDelivered(tripId: string): Promise<boolean> {
    if (this.receiptPdfDeliveredTrips.has(tripId)) return true;
    if (this.redis) {
      const cached = await this.redis.get(`receipt:pdf-sent:${tripId}`).catch(() => null);
      if (cached) return true;
    }
    return false;
  }

  private async markReceiptPdfDelivered(tripId: string): Promise<void> {
    this.receiptPdfDeliveredTrips.add(tripId);
    if (this.redis) {
      await this.redis.set(`receipt:pdf-sent:${tripId}`, '1', 86400).catch(() => undefined);
    }
  }

  private buildEventMessage(dto: EventoEntradaDto): string {
    const parts: string[] = [`Evento: ${dto.tipo} informado por ${dto.origen}.`];
    if (dto.viajeId) parts.push(`Viaje: #${dto.viajeId}.`);
    if (dto.reservaId) parts.push(`Reserva: #${dto.reservaId}.`);
    if (dto.pagoId) parts.push(`Pago: #${dto.pagoId}.`);
    if (dto.detalle?.origen && dto.detalle?.destino) {
      parts.push(`Trayecto: ${dto.detalle.origen} -> ${dto.detalle.destino}.`);
    }
    if (dto.detalle?.importe?.monto !== undefined) {
      parts.push(
        `Importe: ${dto.detalle.importe.moneda || 'ARS'} ${dto.detalle.importe.monto}.`,
      );
    }
    if (dto.detalle?.motivo) {
      parts.push(`Detalle: ${dto.detalle.motivo}.`);
    }
    return parts.join(' ');
  }

  private computePayloadHash(dto: EventoEntradaDto): string {
    const normalized = JSON.stringify({
      tipo: dto.tipo,
      origen: dto.origen,
      viajeId: dto.viajeId ?? null,
      reservaId: dto.reservaId ?? null,
      pagoId: dto.pagoId ?? null,
      destinatarios: dto.destinatarios,
      detalle: dto.detalle ?? null,
    });
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }
}
