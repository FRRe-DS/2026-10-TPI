import {
  Controller,
  Post,
  Body,
  Res,
  Param,
  Get,
  Query,
  Headers,
  Optional,
  NotFoundException,
  BadRequestException,
  ConflictException,
  GoneException,
  UnprocessableEntityException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { DocumentsService } from '../../application/documents.service';
import {
  GenerateQrDto,
  VerifyQrDto,
  ResendReceiptDto,
  ResendReceiptResponseDto,
  RegisterReceiptDto,
  ReceiptResponseDto,
  GenerarQrViajeDto,
  ValidarQrUnificadoDto,
  RegistrarComprobanteUnificadoDto,
  ReenviarComprobanteUnificadoDto,
} from '../../application/dto/documents.dto';

import { GenerateReceiptPdfUseCase } from '../../application/use-cases/generate-receipt-pdf.use-case';
import { RegisterReceiptUseCase } from '../../application/use-cases/register-receipt.use-case';
import { ReceiptRecord } from '../../domain/ports/receipt.repository.port';
import { RedisService } from '../../../../common/redis.service';
import {
  assertResourceOwnership,
  checkIdempotency,
  parseAndAuthorizeJwt,
  saveIdempotency,
} from '../../../../common/contract-security.util';
import { Response } from 'express';
import * as crypto from 'crypto';

@ApiTags('Documentos y QR')
@Controller()
export class DocumentsController {
  private readonly idempotencyStore = new Map<string, { hash: string; response: any }>();
  private readonly activeQrByTrip = new Map<string, string>();
  private readonly replacedQrTokens = new Set<string>();

  constructor(
    private readonly documentsService: DocumentsService,
    private readonly generateReceiptPdfUseCase: GenerateReceiptPdfUseCase,
    private readonly registerReceiptUseCase: RegisterReceiptUseCase,
    @Optional() private readonly redis?: RedisService,
  ) {}

  // ─── QR (Rutas Originales G10) ─────────────────────────────────────────────

  @Post('documents/qr/generate')
  @ApiOperation({ summary: 'Generar código QR temporal de un solo uso para inicio de viaje (RF-8.3)' })
  @ApiResponse({ status: 201, description: 'QR generado exitosamente con DataURL y token' })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  async generateQr(@Body() dto: GenerateQrDto) {
    return this.documentsService.generateQr(dto);
  }

  @Post('documents/qr/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validar y consumir el código QR (RF-8.3 / RF-6.4)' })
  @ApiResponse({ status: 200, description: 'Código QR verificado y consumido exitosamente' })
  @ApiResponse({ status: 400, description: 'El código QR no corresponde al viaje especificado' })
  @ApiResponse({ status: 404, description: 'Código QR no encontrado o inválido' })
  @ApiResponse({ status: 410, description: 'Código QR ya utilizado o expirado (TTL agotado)' })
  async verifyQr(@Body() dto: VerifyQrDto) {
    return this.documentsService.verifyQr(dto);
  }

  // ─── Comprobantes (Rutas Originales G10) ────────────────────────────────────

  /**
   * RF-8.4: Registrar comprobante tras viaje finalizado.
   * Persiste los datos del comprobante. Es idempotente: si el tripId ya tiene
   * un comprobante registrado, devuelve el existente sin crear duplicados.
   */
  @Post('documents/receipts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar comprobante de viaje (RF-8.4)',
    description:
      'Persiste los metadatos del comprobante en base de datos. ' +
      'Idempotente: si ya existe un comprobante para el tripId devuelve el existente. ' +
      'El PDF se genera en el momento de la descarga (GET), no aquí.',
  })
  @ApiResponse({
    status: 201,
    description: 'Comprobante registrado o ya existente devuelto',
    type: ReceiptResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  async registerReceipt(@Body() dto: RegisterReceiptDto): Promise<ReceiptResponseDto> {
    const record = await this.registerReceiptUseCase.execute({
      tripId: dto.tripId,
      passengerId: dto.passengerId,
      passengerEmail: dto.passengerEmail,
      amount: dto.amount,
      currency: dto.currency ?? 'ARS',
      driverName: dto.driverName,
    });

    return {
      id: record.id,
      receiptCode: record.receiptCode,
      tripId: record.tripId,
      passengerId: record.passengerId,
      passengerEmail: record.passengerEmail,
      amount: record.amount,
      currency: record.currency,
      driverName: record.driverName,
      issuedAt: record.issuedAt.toISOString(),
    };
  }

  /**
   * RF-8.4: Descargar el PDF del comprobante existente.
   * NO crea registros. Regenera el PDF on-demand con los datos guardados,
   * preservando la fecha de emisión original.
   * Devuelve 404 si no existe comprobante para ese tripId o comprobanteId.
   */
  @Get('documents/receipts/:tripId/download')
  @ApiOperation({
    summary: 'Descargar comprobante de viaje en PDF (RF-8.4)',
    description:
      'Busca el comprobante guardado para el tripId o comprobanteId, regenera el PDF con los ' +
      'datos originales (fecha de emisión incluida) y lo sirve como descarga. ' +
      'No crea ni modifica registros.',
  })
  @ApiParam({ name: 'tripId', description: 'ID del viaje o comprobanteId', example: 'trip-abc-123' })
  @ApiResponse({ status: 200, description: 'PDF generado y servido como attachment' })
  @ApiResponse({ status: 404, description: 'No existe comprobante registrado para este viaje' })
  async downloadPdf(
    @Param('tripId') tripId: string,
    @Res() res: Response,
  ) {
    let found = await this.documentsService.findReceiptByTripId(tripId);
    if (!found && this.documentsService.findReceiptByIdOrTripId) {
      found = await this.documentsService.findReceiptByIdOrTripId(tripId);
    }

    if (!found) {
      throw new NotFoundException(
        `No existe comprobante registrado para el viaje "${tripId}". ` +
        `Primero registralo vía POST /documents/receipts.`,
      );
    }

    const pdfBytes = await this.generateReceiptPdfUseCase.execute({
      tripId: found.tripId,
      passengerEmail: found.passengerEmail,
      amount: found.amount,
      currency: found.currency,
      driverName: found.driverName,
      issuedAt: found.issuedAt,
    });

    const pdfBuffer = Buffer.from(pdfBytes);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="comprobante-${encodeURIComponent(found.receiptCode)}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });

    res.end(pdfBuffer);
  }

  // ─── Reenvío (RF-8.5 - Ruta Original G10) ──────────────────────────────────

  @Post('documents/receipts/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reenviar comprobante de viaje por email con PDF adjunto (RF-8.5)',
    description:
      'Busca el comprobante registrado para el tripId, regenera el PDF con los ' +
      'datos y fecha originales, y lo envía como archivo adjunto al correo indicado. ' +
      'Devuelve 404 si el comprobante no existe y 502 si falla el envío de correo.',
  })
  @ApiResponse({
    status: 200,
    description: 'Comprobante reenviado con éxito',
    type: ResendReceiptResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  @ApiResponse({ status: 404, description: 'Comprobante no encontrado para el tripId indicado' })
  @ApiResponse({ status: 502, description: 'Error al enviar el correo electrónico (falla SMTP)' })
  async resendReceipt(@Body() dto: ResendReceiptDto): Promise<ResendReceiptResponseDto> {
    return this.documentsService.resendReceipt(dto);
  }

  // ─── Rutas Canónicas del Contrato Coordinado Definitivo (G10 + G7) ──────────

  @Post('viajes/:viajeId/qr')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Generar el QR de verificación de un viaje (RF-8.3 - Contrato Coordinado)',
  })
  @ApiParam({ name: 'viajeId', description: 'Identificador del viaje' })
  @ApiResponse({ status: 201, description: 'QR generado exitosamente' })
  async generarQrViaje(
    @Param('viajeId') viajeId: string,
    @Body() dto: GenerarQrViajeDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwtIdentity = parseAndAuthorizeJwt(authHeader, ['CLIENTE', 'SERVICIO']);
    const passengerId = dto.clienteId ?? dto.passengerId;
    if (!passengerId || !passengerId.trim()) {
      throw new BadRequestException('El campo clienteId (o passengerId) es obligatorio.');
    }

    // Regla del contrato: Un CLIENTE solo puede generarlo para sí mismo (clienteId igual a su sub)
    assertResourceOwnership(jwtIdentity, passengerId, ['CLIENTE']);

    const ttlSeconds = dto.validezSegundos ?? dto.ttlSeconds ?? 600;
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ viajeId, passengerId, ttlSeconds }))
      .digest('hex');

    const cached = await checkIdempotency(
      this.idempotencyStore,
      this.redis,
      'qr-gen',
      idempotencyKey,
      hash,
    );
    if (cached) {
      return cached;
    }

    // Si el viaje ya tenía un QR vigente, el anterior pasa a REEMPLAZADO y deja de ser válido
    const previousToken = this.activeQrByTrip.get(viajeId);
    if (previousToken) {
      this.replacedQrTokens.add(previousToken);
      if (this.redis) {
        await this.redis.set(`qr:replaced:${previousToken}`, 'REEMPLAZADO', 3600).catch(() => undefined);
      }
    }

    const result = await this.documentsService.generateQr({
      tripId: viajeId,
      passengerId,
      ttlSeconds,
    });

    this.activeQrByTrip.set(viajeId, result.token);

    const base64Raw = result.qrDataUrl.replace(/^data:image\/png;base64,/, '');

    const response = {
      qrId: crypto.randomUUID(),
      viajeId: result.tripId,
      tripId: result.tripId,
      estado: 'VIGENTE',
      token: result.token,
      imagenPng: base64Raw,
      qrDataUrl: result.qrDataUrl,
      expiraEn: result.expiresAt,
      expiresAt: result.expiresAt,
      validezSegundos: result.ttlSeconds,
      ttlSeconds: result.ttlSeconds,
    };

    await saveIdempotency(this.idempotencyStore, this.redis, 'qr-gen', idempotencyKey, hash, response);
    return response;
  }

  @Post('qr/validaciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validar y consumir un QR (RF-8.3 / RF-6.4 - Contrato Coordinado)',
  })
  @ApiResponse({ status: 200, description: 'QR válido y consumido' })
  @ApiResponse({ status: 404, description: 'El token no existe' })
  @ApiResponse({ status: 409, description: 'El QR ya fue usado o fue reemplazado' })
  @ApiResponse({ status: 422, description: 'El QR expiró o no corresponde al viajeId indicado' })
  async validarQrUnificado(
    @Body() dto: ValidarQrUnificadoDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    parseAndAuthorizeJwt(authHeader, ['SERVICIO']);
    const tripId = dto.viajeId ?? dto.tripId ?? '';
    if (!dto.token?.trim() || !tripId.trim()) {
      throw new BadRequestException('Los campos token y viajeId son obligatorios.');
    }

    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ token: dto.token, tripId }))
      .digest('hex');

    const cached = await checkIdempotency(
      this.idempotencyStore,
      this.redis,
      'qr-val',
      idempotencyKey,
      hash,
    );
    if (cached) {
      return cached;
    }

    // Verificar si el QR fue reemplazado por uno más reciente (409)
    let isReplaced = this.replacedQrTokens.has(dto.token);
    if (!isReplaced && this.redis) {
      const replacedFlag = await this.redis.get(`qr:replaced:${dto.token}`).catch(() => null);
      if (replacedFlag) {
        isReplaced = true;
      }
    }
    if (isReplaced) {
      throw new ConflictException({
        type: '/errores/qr-reemplazado',
        title: 'El QR fue reemplazado',
        detail: 'El código QR fue reemplazado por uno más reciente para el mismo viaje y ya no es válido.',
      });
    }

    try {
      const result = await this.documentsService.verifyQr({
        token: dto.token,
        tripId,
      });

      const response = {
        qrId: crypto.randomUUID(),
        viajeId: result.tripId,
        tripId: result.tripId,
        usadoEn: result.verifiedAt,
        verifiedAt: result.verifiedAt,
        valido: result.valid,
        valid: result.valid,
        token: result.token,
        mensaje: result.message,
        message: result.message,
      };

      await saveIdempotency(this.idempotencyStore, this.redis, 'qr-val', idempotencyKey, hash, response);
      return response;
    } catch (error) {
      // Mapeo de errores de dominio según contrato coordinado (409 ya usado, 422 expirado o viajeId distinto)
      if (error instanceof GoneException) {
        const msg = error.message || '';
        if (msg.toLowerCase().includes('expirado')) {
          throw new UnprocessableEntityException({
            type: '/errores/qr-expirado',
            title: 'El QR ha expirado',
            detail: msg,
          });
        }
        throw new ConflictException({
          type: '/errores/qr-usado',
          title: 'El QR ya fue usado',
          detail: msg || 'El código QR ya fue utilizado o reemplazado.',
        });
      }
      if (error instanceof BadRequestException) {
        throw new UnprocessableEntityException({
          type: '/errores/qr-viaje-invalido',
          title: 'El QR no corresponde al viaje indicado',
          detail: error.message || 'El código QR no corresponde al viajeId especificado.',
        });
      }
      throw error;
    }
  }

  @Get('comprobantes')
  @ApiOperation({
    summary: 'Listar comprobantes (RF-8.4 - Contrato Coordinado)',
  })
  @ApiQuery({ name: 'viajeId', required: false })
  @ApiQuery({ name: 'pagoId', required: false })
  @ApiQuery({ name: 'clienteId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'size', required: false })
  async listarComprobantes(
    @Query('viajeId') viajeId?: string,
    @Query('pagoId') pagoId?: string,
    @Query('clienteId') clienteId?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwtIdentity = parseAndAuthorizeJwt(authHeader, ['CLIENTE', 'OPERADOR']);
    const effectiveClienteId =
      jwtIdentity.authenticated && jwtIdentity.rol === 'CLIENTE' && jwtIdentity.sub
        ? jwtIdentity.sub
        : clienteId;

    const pageNum = Math.max(0, Number(page ?? 0) || 0);
    const sizeNum = Math.min(100, Math.max(1, Number(size ?? 20) || 20));
    const records = await this.documentsService.findAllReceipts({
      viajeId,
      pagoId,
      clienteId: effectiveClienteId,
    });
    const totalElementos = records.length;
    const totalPaginas = Math.max(1, Math.ceil(totalElementos / sizeNum));
    const slice = records.slice(pageNum * sizeNum, pageNum * sizeNum + sizeNum);
    const mapped = slice.map((r) => this.toUnifiedComprobante(r));

    return {
      page: pageNum,
      size: sizeNum,
      totalElementos,
      totalPaginas,
      items: mapped,
      elementos: mapped,
    };
  }

  @Post('comprobantes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar metadatos de comprobante síncronamente (RF-8.4)',
  })
  @ApiResponse({ status: 201, description: 'Comprobante registrado o existente devuelto' })
  async registrarComprobanteUnificado(@Body() dto: RegistrarComprobanteUnificadoDto) {
    const tripId = dto.viajeId ?? dto.tripId;
    const passengerId = dto.clienteId ?? dto.passengerId;
    const amount = dto.importe?.monto ?? dto.amount;
    const currency = dto.importe?.moneda ?? dto.currency ?? 'ARS';
    const passengerEmail =
      dto.clienteEmail ??
      dto.passengerEmail ??
      `${passengerId || 'pasajero'}@notificaciones.m8.local`;
    const driverName = dto.conductorNombre ?? dto.driverName;

    if (!tripId || !passengerId || amount === undefined || amount <= 0) {
      throw new BadRequestException(
        'Los campos viajeId (o tripId), clienteId (o passengerId) e importe.monto (o amount > 0) son obligatorios.',
      );
    }

    const record = await this.registerReceiptUseCase.execute({
      tripId,
      passengerId,
      passengerEmail,
      amount,
      currency,
      driverName,
    });

    return this.toUnifiedComprobante(record, dto.pagoId, dto.motivo);
  }

  @Get('comprobantes/:comprobanteId')
  @ApiOperation({
    summary: 'Consultar un comprobante (RF-8.4 - Contrato Coordinado)',
  })
  @ApiParam({
    name: 'comprobanteId',
    description: 'UUID del comprobante, código REC-2026-XXXXXX o viajeId',
  })
  @ApiResponse({ status: 200, description: 'Comprobante' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  async obtenerComprobante(
    @Param('comprobanteId') comprobanteId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwtIdentity = parseAndAuthorizeJwt(authHeader, ['CLIENTE', 'OPERADOR']);
    let found = await this.documentsService.findReceiptByTripId(comprobanteId);
    if (!found && this.documentsService.findReceiptByIdOrTripId) {
      found = await this.documentsService.findReceiptByIdOrTripId(comprobanteId);
    }
    if (!found) {
      throw new NotFoundException(`Comprobante "${comprobanteId}" no encontrado.`);
    }
    assertResourceOwnership(jwtIdentity, found.passengerId, ['CLIENTE']);
    return this.toUnifiedComprobante(found);
  }

  @Get('comprobantes/:comprobanteId/pdf')
  @ApiOperation({
    summary: 'Descargar el PDF del comprobante (RF-8.4 - Contrato Coordinado)',
  })
  @ApiParam({
    name: 'comprobanteId',
    description: 'UUID del comprobante, código REC-2026-XXXXXX o viajeId',
  })
  @ApiResponse({ status: 200, description: 'Archivo PDF' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  async descargarComprobantePdf(
    @Param('comprobanteId') comprobanteId: string,
    @Res() res: Response,
    @Headers('authorization') authHeader?: string,
  ) {
    if (authHeader) {
      const jwtIdentity = parseAndAuthorizeJwt(authHeader, ['CLIENTE', 'OPERADOR']);
      let found = await this.documentsService.findReceiptByTripId(comprobanteId);
      if (!found && this.documentsService.findReceiptByIdOrTripId) {
        found = await this.documentsService.findReceiptByIdOrTripId(comprobanteId);
      }
      if (found) {
        assertResourceOwnership(jwtIdentity, found.passengerId, ['CLIENTE']);
      }
    }
    return this.downloadPdf(comprobanteId, res);
  }

  @Post('comprobantes/:comprobanteId/reenvios')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Volver a enviar el comprobante (RF-8.5 - Contrato Coordinado)',
  })
  @ApiParam({
    name: 'comprobanteId',
    description: 'UUID del comprobante, código REC-2026-XXXXXX o viajeId',
  })
  @ApiResponse({ status: 202, description: 'Reenvío aceptado. El envío es asíncrono.' })
  async reenviarComprobanteUnificado(
    @Param('comprobanteId') comprobanteId: string,
    @Body() dto: ReenviarComprobanteUnificadoDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwtIdentity = parseAndAuthorizeJwt(authHeader, ['CLIENTE', 'OPERADOR']);
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ comprobanteId, ...(dto ?? {}) }))
      .digest('hex');

    const cached = await checkIdempotency(
      this.idempotencyStore,
      this.redis,
      'resend',
      idempotencyKey,
      hash,
    );
    if (cached) {
      return cached;
    }

    let found = await this.documentsService.findReceiptByTripId(comprobanteId);
    if (!found && this.documentsService.findReceiptByIdOrTripId) {
      found = await this.documentsService.findReceiptByIdOrTripId(comprobanteId);
    }
    if (!found) {
      throw new NotFoundException(`Comprobante "${comprobanteId}" no encontrado.`);
    }

    assertResourceOwnership(jwtIdentity, found.passengerId, ['CLIENTE']);

    const email = dto.emailDestino ?? dto.email ?? found.passengerEmail;
    const canal = (dto.canal ?? 'EMAIL').toUpperCase();
    const result = await this.documentsService.resendReceipt({
      tripId: found.tripId,
      email,
    });

    const response = {
      notificacionId: crypto.randomUUID(),
      destinatarioId: found.passengerId,
      canal,
      asunto: `Comprobante de Viaje #${result.receiptCode}`,
      estado: result.success ? 'ENVIADA' : 'FALLIDA',
      intentos: 1,
      referencia: {
        tipo: 'VIAJE',
        id: found.tripId,
      },
      creadoEn: result.timestamp,
      ...(result.success ? { enviadoEn: result.timestamp } : {}),
      exito: result.success,
      success: result.success,
      comprobanteId: found.id,
      codigoComprobante: result.receiptCode,
      receiptCode: result.receiptCode,
      viajeId: result.tripId,
      tripId: result.tripId,
      destinatario: result.sentTo,
      sentTo: result.sentTo,
      reenviadoEn: result.timestamp,
      timestamp: result.timestamp,
    };

    await saveIdempotency(this.idempotencyStore, this.redis, 'resend', idempotencyKey, hash, response);
    return response;
  }

  private toUnifiedComprobante(
    record: ReceiptRecord,
    pagoId?: string,
    motivo = 'FINALIZACION_VIAJE',
  ) {
    const issuedIso = record.issuedAt.toISOString();
    return {
      comprobanteId: record.id,
      id: record.id,
      codigoComprobante: record.receiptCode,
      receiptCode: record.receiptCode,
      viajeId: record.tripId,
      tripId: record.tripId,
      ...(pagoId ? { pagoId } : {}),
      clienteId: record.passengerId,
      passengerId: record.passengerId,
      clienteEmail: record.passengerEmail,
      passengerEmail: record.passengerEmail,
      ...(record.driverName
        ? { conductorNombre: record.driverName, driverName: record.driverName }
        : {}),
      motivo,
      estado: 'GENERADO',
      importe: {
        monto: record.amount,
        moneda: record.currency,
      },
      amount: record.amount,
      currency: record.currency,
      emitidoEn: issuedIso,
      issuedAt: issuedIso,
      urlPdf: `/api/v1/comprobantes/${encodeURIComponent(record.id)}/pdf`,
      creadoEn: issuedIso,
    };
  }
}
