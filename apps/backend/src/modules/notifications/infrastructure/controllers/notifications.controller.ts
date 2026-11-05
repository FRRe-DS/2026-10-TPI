import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  Headers,
  Res,
  Optional,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { Response } from 'express';
import * as crypto from 'crypto';
import { NotificationsService } from '../../application/notifications.service';
import {
  EnviarNotificacionUnificadaDto,
  SendNotificationDto,
} from '../../application/dto/send-notification.dto';
import { RedisService } from '../../../../common/redis.service';
import {
  checkIdempotency,
  parseAndAuthorizeJwt,
  saveIdempotency,
} from '../../../../common/contract-security.util';

@ApiTags('Notificaciones')
@Controller()
export class NotificationsController {
  private readonly idempotencyStore = new Map<string, { hash: string; response: any }>();

  constructor(
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  // ─── Rutas Originales G10 (Retrocompatibilidad Frontend y Tests) ────────────

  @Post('notifications/send')
  @ApiOperation({ summary: 'Enviar una notificación inmediata (RF-8.1, RF-8.2)' })
  @ApiBody({ type: SendNotificationDto })
  @ApiResponse({
    status: 201,
    description: 'Intento registrado; status indica si el envío fue exitoso',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        id: { type: 'string', example: 'notification-uuid' },
        status: {
          type: 'string',
          enum: ['SENT', 'FAILED'],
          example: 'SENT',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Datos de la notificación inválidos' })
  @ApiResponse({
    status: 500,
    description: 'No se pudo registrar el intento de notificación',
  })
  async send(@Body() dto: SendNotificationDto) {
    return this.notificationsService.send(dto);
  }

  @Get('notifications/logs')
  @ApiOperation({ summary: 'Consultar el historial y estado de notificaciones enviadas (RF-8.6)' })
  @ApiQuery({ name: 'recipient', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'SENT', 'FAILED'] })
  async getLogs(@Query('recipient') recipient?: string, @Query('status') status?: string) {
    return this.notificationsService.getLogs(recipient, status);
  }

  // ─── Rutas Canónicas del Contrato Coordinado Definitivo (G10 + G7) ──────────

  @Post('notificaciones')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Enviar una notificación manual (RF-8.1, RF-8.2 - Contrato Coordinado)',
  })
  @ApiBody({ type: EnviarNotificacionUnificadaDto })
  @ApiResponse({ status: 202, description: 'Notificación registrada. El envío es asíncrono.' })
  @ApiResponse({ status: 400, description: 'Solicitud inválida' })
  @ApiResponse({ status: 422, description: 'Conflicto de idempotencia' })
  async enviarNotificacion(
    @Body() dto: EnviarNotificacionUnificadaDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
    @Headers('authorization') authHeader?: string,
  ) {
    parseAndAuthorizeJwt(authHeader, ['OPERADOR']);
    const bodyHash = crypto.createHash('sha256').update(JSON.stringify(dto ?? {})).digest('hex');

    const cached = await checkIdempotency(
      this.idempotencyStore,
      this.redis,
      'notif-send',
      idempotencyKey,
      bodyHash,
    );
    if (cached) {
      const cachedId = cached?.notificacionId ?? cached?.id;
      if (res && typeof res.setHeader === 'function' && cachedId) {
        res.setHeader('Location', `/api/v1/notificaciones/${encodeURIComponent(cachedId)}`);
      }
      return cached;
    }

    const response = await this.notificationsService.enviarUnificada(dto);
    const notifId = response?.notificacionId ?? response?.id;
    if (res && typeof res.setHeader === 'function' && notifId) {
      res.setHeader('Location', `/api/v1/notificaciones/${encodeURIComponent(notifId)}`);
    }

    await saveIdempotency(
      this.idempotencyStore,
      this.redis,
      'notif-send',
      idempotencyKey,
      bodyHash,
      response,
    );
    return response;
  }

  @Get('notificaciones')
  @ApiOperation({
    summary: 'Listar notificaciones paginadas con filtros (RF-8.6 - Contrato Coordinado)',
  })
  @ApiQuery({ name: 'destinatarioId', required: false })
  @ApiQuery({ name: 'recipient', required: false })
  @ApiQuery({
    name: 'estado',
    required: false,
    enum: ['PENDIENTE', 'ENVIADA', 'FALLIDA', 'PENDING', 'SENT', 'FAILED'],
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'canal', required: false, enum: ['EMAIL', 'SMS', 'PUSH'] })
  @ApiQuery({ name: 'referenciaId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'size', required: false })
  async listarNotificaciones(
    @Query('destinatarioId') destinatarioId?: string,
    @Query('recipient') recipient?: string,
    @Query('estado') estado?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('canal') canal?: string,
    @Query('referenciaId') referenciaId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    parseAndAuthorizeJwt(authHeader, ['OPERADOR', 'SERVICIO']);
    return this.notificationsService.listarPaginadas({
      recipient: destinatarioId ?? recipient,
      status: estado ?? status,
      canal,
      referenciaId,
      page: page !== undefined ? Number(page) : 0,
      size: size !== undefined ? Number(size) : 20,
    });
  }

  @Get('notificaciones/:notificacionId')
  @ApiOperation({
    summary: 'Consultar el estado de una notificación (RF-8.6 - Contrato Coordinado)',
  })
  @ApiParam({ name: 'notificacionId', description: 'UUID de la notificación' })
  @ApiResponse({ status: 200, description: 'Notificación' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  async obtenerNotificacion(
    @Param('notificacionId') notificacionId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    parseAndAuthorizeJwt(authHeader, ['OPERADOR', 'SERVICIO']);
    return this.notificationsService.findById(notificacionId);
  }

  @Get('notificaciones/:notificacionId/intentos')
  @ApiOperation({
    summary: 'Historial de intentos de entrega (RF-8.6 - Contrato Coordinado)',
  })
  @ApiParam({ name: 'notificacionId', description: 'UUID de la notificación' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'size', required: false })
  async listarIntentos(
    @Param('notificacionId') notificacionId: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    parseAndAuthorizeJwt(authHeader, ['OPERADOR', 'SERVICIO']);
    return this.notificationsService.getIntentos(
      notificacionId,
      page !== undefined ? Number(page) : 0,
      size !== undefined ? Number(size) : 20,
    );
  }

  @Post('notificaciones/:notificacionId/reintentos')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Reintentar una notificación fallida (RF-8.6 - Contrato Coordinado)',
  })
  @ApiParam({ name: 'notificacionId', description: 'UUID de la notificación' })
  @ApiResponse({ status: 202, description: 'Reintento aceptado' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  @ApiResponse({ status: 409, description: 'Solo se puede reintentar una notificación en FALLIDA' })
  async reintentarNotificacion(
    @Param('notificacionId') notificacionId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    parseAndAuthorizeJwt(authHeader, ['OPERADOR']);
    const cached = await checkIdempotency(
      this.idempotencyStore,
      this.redis,
      'notif-retry',
      idempotencyKey,
      notificacionId,
    );
    if (cached) {
      return cached;
    }

    const response = await this.notificationsService.retry(notificacionId);
    await saveIdempotency(
      this.idempotencyStore,
      this.redis,
      'notif-retry',
      idempotencyKey,
      notificacionId,
      response,
    );
    return response;
  }
}
