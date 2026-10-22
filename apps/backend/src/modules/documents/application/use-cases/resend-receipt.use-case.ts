import {
  Injectable,
  Inject,
  NotFoundException,
  BadGatewayException,
  Logger,
} from '@nestjs/common';
import {
  ReceiptRepositoryPort,
  RECEIPT_REPOSITORY_PORT,
} from '../../domain/ports/receipt.repository.port';
import { GenerateReceiptPdfUseCase } from './generate-receipt-pdf.use-case';
import { NotificationsService } from '../../../notifications/application/notifications.service';
import { NotificationChannelDto } from '../../../notifications/application/dto/send-notification.dto';
import {
  ResendReceiptDto,
  ResendReceiptResponseDto,
} from '../dto/documents.dto';

/**
 * Caso de uso: Reenviar comprobante de viaje por correo electrónico (RF-8.5)
 *
 * Flujo:
 * 1. Busca el comprobante persistido en base de datos.
 * 2. Lanza 404 (NotFoundException) si no existe, sin enviar correo.
 * 3. Regenera el PDF con los datos y la fecha original (issuedAt) guardada.
 * 4. Envía el correo adjuntando el PDF con nombre `comprobante-${receiptCode}.pdf`.
 * 5. No crea nuevos comprobantes ni muta su fecha.
 * 6. Lanza 502 (BadGatewayException) si falla el servicio de correo (no informa éxito falso).
 */
@Injectable()
export class ResendReceiptUseCase {
  private readonly logger = new Logger(ResendReceiptUseCase.name);

  constructor(
    @Inject(RECEIPT_REPOSITORY_PORT)
    private readonly receiptRepo: ReceiptRepositoryPort,
    private readonly generateReceiptPdfUseCase: GenerateReceiptPdfUseCase,
    private readonly notificationsService: NotificationsService,
  ) {}

  async execute(dto: ResendReceiptDto): Promise<ResendReceiptResponseDto> {
    // 1. Buscar comprobante persistido
    const receipt = await this.receiptRepo.findByTripId(dto.tripId);

    // 2. Si no existe, responder 404 sin enviar correo
    if (!receipt) {
      this.logger.warn(
        `Intento de reenvío para viaje inexistente: tripId=${dto.tripId}`,
      );
      throw new NotFoundException(
        `No existe comprobante registrado para el viaje "${dto.tripId}". ` +
        `Primero registralo vía POST /documents/receipts.`,
      );
    }

    // 3. Regenerar el PDF con los datos y fecha de emisión original
    const pdfBytes = await this.generateReceiptPdfUseCase.execute({
      tripId: receipt.tripId,
      passengerEmail: receipt.passengerEmail,
      amount: receipt.amount,
      currency: receipt.currency,
      driverName: receipt.driverName,
      issuedAt: receipt.issuedAt,
    });

    const attachmentFilename = `comprobante-${receipt.receiptCode}.pdf`;

    this.logger.log(
      `Reenviando comprobante ${receipt.receiptCode} para viaje ${dto.tripId} a ${dto.email} con adjunto ${attachmentFilename}`,
    );

    // 4. Enviar PDF como adjunto oficial
    const sendResult = await this.notificationsService.send({
      channel: NotificationChannelDto.EMAIL,
      recipient: dto.email,
      subject: `Comprobante de Viaje #${receipt.receiptCode}`,
      content:
        `Estimado/a, adjuntamos su comprobante oficial correspondiente al viaje ` +
        `#${receipt.tripId} (${receipt.receiptCode}). ` +
        `Total abonado: ${receipt.currency} ${receipt.amount.toFixed(2)}.`,
      referenceId: receipt.tripId,
      referenceType: 'TRIP',
      attachments: [
        {
          filename: attachmentFilename,
          content: Buffer.from(pdfBytes),
          contentType: 'application/pdf',
        },
      ],
    });

    // 6. No informar éxito si falla el envío de correo
    if (!sendResult.success) {
      this.logger.error(
        `Fallo al enviar correo a ${dto.email} para comprobante ${receipt.receiptCode}`,
      );
      throw new BadGatewayException(
        `No se pudo enviar el correo electrónico con el comprobante adjunto a "${dto.email}". ` +
        `Verifique el estado del servidor de correo.`,
      );
    }

    return {
      success: true,
      tripId: dto.tripId,
      receiptCode: receipt.receiptCode,
      sentTo: dto.email,
      timestamp: new Date().toISOString(),
    };
  }
}

