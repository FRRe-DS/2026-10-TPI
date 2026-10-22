import {
  Controller,
  Post,
  Body,
  Res,
  Param,
  Get,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { DocumentsService } from '../../application/documents.service';
import {
  GenerateQrDto,
  VerifyQrDto,
  ResendReceiptDto,
  ResendReceiptResponseDto,
  RegisterReceiptDto,
  ReceiptResponseDto,
} from '../../application/dto/documents.dto';

import { GenerateReceiptPdfUseCase } from '../../application/use-cases/generate-receipt-pdf.use-case';
import { RegisterReceiptUseCase } from '../../application/use-cases/register-receipt.use-case';
import { Response } from 'express';

@ApiTags('Documentos y QR')
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly generateReceiptPdfUseCase: GenerateReceiptPdfUseCase,
    private readonly registerReceiptUseCase: RegisterReceiptUseCase,
  ) {}

  // ─── QR ────────────────────────────────────────────────────────────────────

  @Post('qr/generate')
  @ApiOperation({ summary: 'Generar código QR temporal de un solo uso para inicio de viaje (RF-8.3)' })
  @ApiResponse({ status: 201, description: 'QR generado exitosamente con DataURL y token' })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  async generateQr(@Body() dto: GenerateQrDto) {
    return this.documentsService.generateQr(dto);
  }

  @Post('qr/verify')
  @ApiOperation({ summary: 'Validar y consumir el código QR (RF-8.3 / RF-6.4)' })
  @ApiResponse({ status: 200, description: 'Código QR verificado y consumido exitosamente' })
  @ApiResponse({ status: 400, description: 'El código QR no corresponde al viaje especificado' })
  @ApiResponse({ status: 404, description: 'Código QR no encontrado o inválido' })
  @ApiResponse({ status: 410, description: 'Código QR ya utilizado o expirado (TTL agotado)' })
  async verifyQr(@Body() dto: VerifyQrDto) {
    return this.documentsService.verifyQr(dto);
  }

  // ─── Comprobantes ───────────────────────────────────────────────────────────

  /**
   * RF-8.4: Registrar comprobante tras viaje finalizado.
   * Persiste los datos del comprobante. Es idempotente: si el tripId ya tiene
   * un comprobante registrado, devuelve el existente sin crear duplicados.
   */
  @Post('receipts')
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
   * Devuelve 404 si no existe comprobante para ese tripId.
   */
  @Get('receipts/:tripId/download')
  @ApiOperation({
    summary: 'Descargar comprobante de viaje en PDF (RF-8.4)',
    description:
      'Busca el comprobante guardado para el tripId, regenera el PDF con los ' +
      'datos originales (fecha de emisión incluida) y lo sirve como descarga. ' +
      'No crea ni modifica registros.',
  })
  @ApiParam({ name: 'tripId', description: 'ID del viaje', example: 'trip-abc-123' })
  @ApiResponse({ status: 200, description: 'PDF generado y servido como attachment' })
  @ApiResponse({ status: 404, description: 'No existe comprobante registrado para este viaje' })
  async downloadPdf(
    @Param('tripId') tripId: string,
    @Res() res: Response,
  ) {
    const found = await this.documentsService.findReceiptByTripId(tripId);

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

  // ─── Reenvío (RF-8.5) ───────────────────────────────────────────────────────

  @Post('receipts/resend')
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
}
