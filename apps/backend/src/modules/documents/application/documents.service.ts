import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  GenerateQrDto,
  VerifyQrDto,
  ResendReceiptDto,
} from './dto/documents.dto';
import {
  ReceiptRecord,
  ReceiptRepositoryPort,
  RECEIPT_REPOSITORY_PORT,
} from '../domain/ports/receipt.repository.port';
import { GenerateQrUseCase } from './use-cases/generate-qr.use-case';
import { VerifyQrUseCase } from './use-cases/verify-qr.use-case';
import { ResendReceiptUseCase } from './use-cases/resend-receipt.use-case';

/**
 * Servicio de aplicación para Documentos y QR (Módulo 8)
 *
 * Fachada de aplicación que delega sus operaciones a casos de uso hexagonales:
 * - GenerateQrUseCase (RF-8.3)
 * - VerifyQrUseCase (RF-8.3 / RF-6.4 / RNF-08)
 * - ResendReceiptUseCase (RF-8.5)
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly generateQrUseCase: GenerateQrUseCase,
    private readonly verifyQrUseCase: VerifyQrUseCase,
    @Inject(RECEIPT_REPOSITORY_PORT)
    private readonly receiptRepo: ReceiptRepositoryPort,
    private readonly resendReceiptUseCase: ResendReceiptUseCase,
  ) {}

  // ─── QR (RF-8.3 / RF-6.4) ───────────────────────────────────────────────────

  async generateQr(dto: GenerateQrDto) {
    return this.generateQrUseCase.execute(dto);
  }

  async verifyQr(dto: VerifyQrDto) {
    return this.verifyQrUseCase.execute(dto);
  }

  // ─── Comprobantes (RF-8.4) ──────────────────────────────────────────────────

  /**
   * Busca un comprobante existente por tripId.
   * Utilizado por el controlador para la descarga (el GET no crea registros).
   */
  async findReceiptByTripId(tripId: string): Promise<ReceiptRecord | null> {
    return this.receiptRepo.findByTripId(tripId);
  }

  // ─── Reenvío (RF-8.5) ───────────────────────────────────────────────────────
  async resendReceipt(dto: ResendReceiptDto) {
    return this.resendReceiptUseCase.execute(dto);
  }
}
