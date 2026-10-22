import { Injectable, Inject, Logger } from '@nestjs/common';
import { GenerateQrDto } from '../dto/documents.dto';
import {
  QrTokenRepositoryPort,
  QR_TOKEN_REPOSITORY_PORT,
} from '../../domain/ports/qr-token.repository.port';
import { RedisService } from '../../../../common/redis.service';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';

export interface GenerateQrResult {
  token: string;
  tripId: string;
  qrDataUrl: string;
  expiresAt: string;
  ttlSeconds: number;
}

/**
 * Caso de uso: Generar código QR temporal de un solo uso para inicio de viaje (RF-8.3)
 *
 * Flujo:
 * 1. Calcula TTL (por defecto 300 segundos).
 * 2. Genera token criptográficamente seguro (formato qr_<tripId>_<hex>).
 * 3. Almacena en Redis con TTL para consulta rápida y expiración automática.
 * 4. Persiste en el repositorio de tokens (Prisma / PostgreSQL / Supabase) para trazabilidad.
 * 5. Genera la imagen QR en formato base64 (DataURL) con nivel de corrección alto ('H').
 */
@Injectable()
export class GenerateQrUseCase {
  private readonly logger = new Logger(GenerateQrUseCase.name);

  constructor(
    @Inject(QR_TOKEN_REPOSITORY_PORT)
    private readonly qrTokenRepo: QrTokenRepositoryPort,
    private readonly redis: RedisService,
  ) {}

  async execute(dto: GenerateQrDto): Promise<GenerateQrResult> {
    const ttl = dto.ttlSeconds || 300;
    const randomHex = crypto.randomBytes(16).toString('hex');
    const token = `qr_${dto.tripId}_${randomHex}`;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    const payload = JSON.stringify({
      token,
      tripId: dto.tripId,
      passengerId: dto.passengerId,
      expiresAt: expiresAt.toISOString(),
      isUsed: false,
    });

    // 1. Almacenar en Redis con TTL para acceso rápido y expiración automática
    await this.redis.set(`qr:${token}`, payload, ttl);

    // 2. Almacenar mediante el puerto de repositorio para persistencia y auditoría
    await this.qrTokenRepo.save({
      token,
      tripId: dto.tripId,
      passengerId: dto.passengerId,
      expiresAt,
      isUsed: false,
    });

    // 3. Renderizar código QR en base64 (DataURL)
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
}
