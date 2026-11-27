import { Logger } from '@nestjs/common';
import {
  ReceiptData,
  ReceiptRecord,
} from '../../domain/ports/receipt.repository.port';
import { GenerateReceiptPdfUseCase } from './generate-receipt-pdf.use-case';
import { RegisterReceiptUseCase } from './register-receipt.use-case';

export interface IssuedReceipt {
  /** Comprobante persistido (nuevo o el ya existente para ese viaje). */
  receipt: ReceiptRecord;
  /** Buffer PDF generado con PDFKit; `null` si la generación falló. */
  pdf: Buffer | null;
  /** Motivo del fallo de generación (solo si `pdf` es `null`). */
  pdfError?: string;
}

/** Cabecera y marca de fin que debe tener todo PDF válido. */
const PDF_HEADER = '%PDF-';
const PDF_EOF = '%%EOF';

/**
 * Caso de uso: Emitir el comprobante de un viaje confirmado (RF-8.4).
 *
 * Se invoca como CONSECUENCIA de la confirmación del viaje o del pago (evento
 * VIAJE_FINALIZADO / PAGO_CAPTURADO), sin depender de una descarga ni de un reenvío:
 *  1. Registra el comprobante de forma idempotente (RegisterReceiptUseCase): un evento
 *     repetido para el mismo viaje devuelve el mismo registro, sin duplicados.
 *  2. Genera el PDF con PDFKit usando los datos persistidos y la fecha de emisión original.
 *  3. Verifica que los bytes generados sean un PDF válido (cabecera %PDF- y marca %%EOF).
 *
 * Si la generación falla, el comprobante queda igualmente registrado y el resultado lo
 * informa (`pdf: null`): emitir documentos nunca debe bloquear a quien avisa el hito, y
 * el PDF puede regenerarse a demanda en la descarga o el reenvío.
 *
 * El PDF no se almacena (sin Supabase Storage): descarga y reenvío lo regeneran con los
 * mismos datos y la misma fecha de emisión.
 */
export class IssueReceiptUseCase {
  private readonly logger = new Logger(IssueReceiptUseCase.name);

  constructor(
    private readonly registerReceipt: RegisterReceiptUseCase,
    private readonly generateReceiptPdf: GenerateReceiptPdfUseCase,
  ) {}

  async execute(data: ReceiptData): Promise<IssuedReceipt> {
    const receipt = await this.registerReceipt.execute(data);

    try {
      const bytes = await this.generateReceiptPdf.execute({
        tripId: receipt.tripId,
        passengerEmail: receipt.passengerEmail,
        amount: receipt.amount,
        currency: receipt.currency,
        driverName: receipt.driverName,
        issuedAt: receipt.issuedAt,
      });

      const pdf = Buffer.from(bytes);
      this.assertValidPdf(pdf);

      this.logger.log(
        `PDF generado para el comprobante ${receipt.receiptCode} (viaje ${receipt.tripId}, ${pdf.length} bytes)`,
      );
      return { receipt, pdf };
    } catch (error) {
      const pdfError = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `No se pudo generar el PDF del comprobante ${receipt.receiptCode} (viaje ${receipt.tripId}): ${pdfError}`,
      );
      return { receipt, pdf: null, pdfError };
    }
  }

  private assertValidPdf(pdf: Buffer): void {
    const isValid =
      pdf.length > 0 &&
      pdf.subarray(0, PDF_HEADER.length).toString('latin1') === PDF_HEADER &&
      pdf.toString('latin1').includes(PDF_EOF);
    if (!isValid) {
      throw new Error('El generador no devolvió un PDF válido (falta %PDF- o %%EOF).');
    }
  }
}
