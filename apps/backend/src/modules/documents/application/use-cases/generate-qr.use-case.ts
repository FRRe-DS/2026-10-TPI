import { Injectable, Inject, Logger } from '@nestjs/common';
import { GenerateQrDto } from '../dto/documents.dto';
import {
  QrTokenRepositoryPort,
  QR_TOKEN_REPOSITORY_PORT,
} from '../../domain/ports/qr-token.repository.port';
import { RedisService } from '../../../../common/redis.service';
import {
  assertOpaqueQrPayload,
  maskQrToken,
  sanitizeTripIdForQrToken,
} from '../../../../common/privacy-masking.util';
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
 * Caso de uso: Generar código QR temporal de un solo uso para inicio de viaje (RF-8.3 / RNF-08)
 *
 * Flujo:
 * 1. Calcula TTL (por defecto 300 segundos).
 * 2. Verifica en Redis (`trip:{viajeId}:active_token`) si existía un QR previo en estado VIGENTE
 *    para ese viaje; de ser así, lo marca como REEMPLAZADO en Redis.
 * 3. Genera token criptográficamente seguro (formato qr_<tripId>_<hex>).
 * 4. Almacena en Redis (`qr:{token}` y `trip:{viajeId}:active_token`) con TTL para consulta rápida
 *    y expiración automática.
 * 5. Persiste en el repositorio de tokens (Prisma / PostgreSQL / Supabase) para trazabilidad.
 * 6. Genera la imagen QR en formato base64 (DataURL) con nivel de corrección alto ('H').
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
    const safeTripPrefix = sanitizeTripIdForQrToken(dto.tripId);
    const token = `qr_${safeTripPrefix}_${randomHex}`;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const activeTokenKey = `trip:${dto.tripId}:active_token`;

    // Validación estricta RNF-19: el payload del QR solo lleva el token opaco criptográfico, sin datos personales
    const forbiddenValues = dto.passengerId !== safeTripPrefix ? [dto.passengerId] : [];
    assertOpaqueQrPayload(token, forbiddenValues);

    // 1. Si existía un QR previo en estado VIGENTE para este viaje, marcarlo como REEMPLAZADO
    const previousToken = await this.redis.get(activeTokenKey);
    if (previousToken && previousToken !== token) {
      let previousData: Record<string, any> = {
        token: previousToken,
        tripId: dto.tripId,
        passengerId: dto.passengerId,
        expiresAt: expiresAt.toISOString(),
        isUsed: false,
      };

      const previousRaw = await this.redis.get(`qr:${previousToken}`);
      if (previousRaw) {
        try {
          previousData = { ...previousData, ...JSON.parse(previousRaw) };
        } catch {
          // Conservar datos base si el valor previo no era JSON válido
        }
      }

      if (!previousData.isUsed && previousData.estado !== 'USADO') {
        await this.redis.set(
          `qr:${previousToken}`,
          JSON.stringify({
            ...previousData,
            estado: 'REEMPLAZADO',
          }),
          ttl,
        );
      }
    }

    const payload = JSON.stringify({
      token,
      tripId: dto.tripId,
      passengerId: dto.passengerId,
      expiresAt: expiresAt.toISOString(),
      isUsed: false,
      estado: 'VIGENTE',
    });

    // 2. Almacenar en Redis con TTL e indexar token activo del viaje
    await this.redis.set(`qr:${token}`, payload, ttl);
    await this.redis.set(activeTokenKey, token, ttl);

    // 3. Almacenar mediante el puerto de repositorio para persistencia y auditoría
    await this.qrTokenRepo.save({
      token,
      tripId: dto.tripId,
      passengerId: dto.passengerId,
      expiresAt,
      isUsed: false,
    });

    // 4. Renderizar código QR en base64 (DataURL)
    const qrDataUrl = await QRCode.toDataURL(token, {
      errorCorrectionLevel: 'H',
      margin: 2,
      scale: 8,
    });

    this.logger.log(
      `QR generado para viaje ${safeTripPrefix} (token=${maskQrToken(token)}, TTL=${ttl}s)`,
    );

    return {
      token,
      tripId: dto.tripId,
      qrDataUrl,
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: ttl,
    };
  }
}
