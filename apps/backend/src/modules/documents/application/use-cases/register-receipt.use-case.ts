import { Inject } from '@nestjs/common';
import {
  ReceiptData,
  ReceiptRecord,
  ReceiptRepositoryPort,
  RECEIPT_REPOSITORY_PORT,
} from '../../domain/ports/receipt.repository.port';

/**
 * Caso de uso: Registrar un comprobante de viaje (RF-8.4)
 *
 * Responsabilidad única: persistir los metadatos del comprobante.
 * Es idempotente: llamadas repetidas con el mismo tripId devuelven
 * el comprobante existente sin crear duplicados.
 *
 * No genera el PDF (eso lo hace GenerateReceiptPdfUseCase).
 * No envía correo (eso lo hará SendReceiptEmailUseCase en el futuro).
 */
export class RegisterReceiptUseCase {
  constructor(
    @Inject(RECEIPT_REPOSITORY_PORT)
    private readonly receiptRepo: ReceiptRepositoryPort,
  ) {}

  execute(data: ReceiptData): Promise<ReceiptRecord> {
    return this.receiptRepo.save(data);
  }
}

