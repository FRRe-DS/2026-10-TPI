import { Controller, Post, Body, Res, Param, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DocumentsService } from '../../application/documents.service';
import { GenerateQrDto, VerifyQrDto, ResendReceiptDto } from '../../application/dto/documents.dto';
import { Response } from 'express';

@ApiTags('Documentos y QR')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) { }

  @Post('qr/generate')
  @ApiOperation({ summary: 'Generar código QR temporal de un solo uso para inicio de viaje (RF-8.3)' })
  @ApiResponse({ status: 201, description: 'QR generado exitosamente con DataURL y token' })
  async generateQr(@Body() dto: GenerateQrDto) {
    return this.documentsService.generateQr(dto);
  }

  @Post('qr/verify')
  @ApiOperation({ summary: 'Validar y consumir el código QR (RF-8.3 / RF-6.4)' })
  @ApiResponse({ status: 200, description: 'Código QR verificado y consumido' })
  async verifyQr(@Body() dto: VerifyQrDto) {
    return this.documentsService.verifyQr(dto);
  }

  @Post('receipts/resend')
  @ApiOperation({ summary: 'Reenviar comprobante de viaje por email (RF-8.5)' })
  @ApiResponse({ status: 200, description: 'Comprobante reenviado con éxito' })
  async resendReceipt(@Body() dto: ResendReceiptDto) {
    return this.documentsService.resendReceipt(dto);
  }

  @Get('receipts/:tripId/download')
  @ApiOperation({ summary: 'Descargar comprobante de viaje generado en PDF (RF-8.4)' })
  async downloadPdf(@Param('tripId') tripId: string, @Res() res: Response) {
    const pdfBuffer = await this.documentsService.generateReceiptPdfBuffer({
      tripId,
      passengerEmail: 'pasajero@ejemplo.com',
      amount: 3500.0,
      currency: 'ARS',
      driverName: 'Conductor Asignado',
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=comprobante-${tripId}.pdf`,
      'Content-Length': pdfBuffer.length,
    });

    res.end(pdfBuffer);
  }
}
