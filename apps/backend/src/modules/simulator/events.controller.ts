import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Optional,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { NotificationsService } from '../notifications/application/notifications.service';
import { NotificationChannelDto } from '../notifications/application/dto/send-notification.dto';
import { RegisterReceiptUseCase } from '../documents/application/use-cases/register-receipt.use-case';
import { RedisService } from '../../common/redis.service';
import {
  checkIdempotency,
  parseAndAuthorizeJwt,
  saveIdempotency,
} from '../../common/contract-security.util';
import * as crypto from 'crypto';

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
@Controller(['eventos', 'events'])
export class EventsController {
  private readonly logger = new Logger(EventsController.name);
  private readonly processedEvents = new Map<string, { hash: string; response: any }>();

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly registerReceiptUseCase: RegisterReceiptUseCase,
    @Optional() private readonly redis?: RedisService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Informar un hito de viaje, reserva o pago (RF-8.1, RF-8.2, RF-8.8)',
    description:
      'M5, M6, M7 y M9 informan acá cada hito. M8 lo registra con idempotencia por eventoId y responde 202 Accepted.',
  })
  @ApiBody({ type: EventoEntradaDto })
  @ApiResponse({ status: 202, description: 'Evento recibido. Se procesa de forma asíncrona.' })
  @ApiResponse({ status: 400, description: 'Solicitud inválida (falta referencia o destinatarios)' })
  @ApiResponse({ status: 422, description: 'Conflicto de idempotencia (mismo eventoId con cuerpo distinto)' })
  async recibirEvento(
    @Body() dto: EventoEntradaDto,
    @Headers('authorization') authHeader?: string,
  ) {
    parseAndAuthorizeJwt(authHeader, ['SERVICIO']);
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

    // 1. Si el evento implica emisión de comprobante (RF-8.4)
    const tipoUpper = dto.tipo.toUpperCase();
    const emitsReceipt =
      tipoUpper === 'VIAJE_FINALIZADO' ||
      tipoUpper === 'PAGO_CAPTURADO' ||
      tipoUpper === 'REINTEGRO_REGISTRADO';

    const tripIdForReceipt = dto.viajeId ?? dto.pagoId;
    if (emitsReceipt && tripIdForReceipt) {
      const clienteDest =
        dto.destinatarios.find((d) => d.rol?.toUpperCase() === 'CLIENTE') ??
        dto.destinatarios[0];
      const passengerId = clienteDest?.usuarioId || `usr-${tripIdForReceipt}`;
      const passengerEmail =
        clienteDest?.email || `${passengerId}@notificaciones.m8.local`;
      const amount =
        dto.detalle?.importe?.monto && dto.detalle.importe.monto > 0
          ? dto.detalle.importe.monto
          : 3500;
      const currency = dto.detalle?.importe?.moneda || 'ARS';

      await this.registerReceiptUseCase.execute({
        tripId: tripIdForReceipt,
        passengerId,
        passengerEmail,
        amount,
        currency,
      });
    }

    // 2. Despachar notificaciones multicanal a cada destinatario (RF-8.1, RF-8.2)
    const referenceId = dto.viajeId ?? dto.reservaId ?? dto.pagoId;
    const referenceType = dto.viajeId
      ? 'TRIP'
      : dto.reservaId
        ? 'RESERVATION'
        : 'PAYMENT';
    const subject =
      EVENT_SUBJECTS[tipoUpper] ?? `Notificación de ${dto.tipo} (${dto.origen})`;
    const content = this.buildEventMessage(dto);

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

      const perRecipientEventId =
        dto.destinatarios.length === 1 ? dto.eventoId : `${dto.eventoId}:${i}`;

      await this.notificationsService.send(
        {
          channel,
          recipient,
          subject,
          content,
          referenceId,
          referenceType,
        },
        perRecipientEventId,
      );
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
