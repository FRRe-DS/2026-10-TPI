import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { GenerateQrDto, VerifyQrDto, ResendReceiptDto } from './dto/documents.dto';
import { RedisService } from '../../../common/redis.service';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { NotificationChannelDto } from '../../notifications/application/dto/send-notification.dto';
import {
  ReceiptRecord,
  ReceiptRepositoryPort,
  RECEIPT_REPOSITORY_PORT,
} from '../domain/ports/receipt.repository.port';
import { ResendReceiptUseCase } from './use-cases/resend-receipt.use-case';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly notificationsService: NotificationsService,
    @Inject(RECEIPT_REPOSITORY_PORT)
    private readonly receiptRepo: ReceiptRepositoryPort,
    private readonly resendReceiptUseCase: ResendReceiptUseCase,
  ) {}


  // ─── QR (RF-8.3 / RF-6.4) ───────────────────────────────────────────────────

  async generateQr(dto: GenerateQrDto) {
    const ttl = dto.ttlSeconds || 300;
    const randomHex = crypto.randomBytes(16).toString('hex');
    const token = `qr_${dto.tripId}_${randomHex}`;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    const payload = JSON.stringify({
      token,
      tripId: dto.tripId,
      passengerId: dto.passengerId,
      expiresAt: expiresAt.toISOString(),
    });

    await this.redis.set(`qr:${token}`, payload, ttl);

    const qrDataUrl = await QRCode.toDataURL(token, {
      errorCorrectionLevel: 'H',
      margin: 2,
      scale: 8,
    });

    this.logger.log(`QR generado para viaje ${dto.tripId} con TTL ${ttl}s`);

    return {
      token,
      tripId: dto.tripId,
      qrDataUrl,
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: ttl,
    };
  }

  async verifyQr(dto: VerifyQrDto) {
    const cached = await this.redis.get(`qr:${dto.token}`);

    if (!cached) {
      throw new NotFoundException(
        'Código QR inválido o expirado (TTL vencido o ya utilizado).',
      );
    }

    const data = JSON.parse(cached);
    if (data.tripId !== dto.tripId) {
      throw new BadRequestException(
        'El código QR no corresponde a este viaje.',
      );
    }

    await this.redis.del(`qr:${dto.token}`);

    this.logger.log(`QR verificado y consumido para viaje ${dto.tripId}`);

    return {
      valid: true,
      tripId: dto.tripId,
      verifiedAt: new Date().toISOString(),
      message: 'Código QR verificado exitosamente. Inicio de viaje habilitado.',
    };
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
