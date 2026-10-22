import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  GoneException,
  BadRequestException,
} from '@nestjs/common';
import { VerifyQrDto } from '../dto/documents.dto';
import {
  QrTokenRepositoryPort,
  QR_TOKEN_REPOSITORY_PORT,
} from '../../domain/ports/qr-token.repository.port';
import { RedisService } from '../../../../common/redis.service';

export interface VerifyQrResult {
  valid: boolean;
  tripId: string;
  token: string;
  verifiedAt: string;
  message: string;
}

/**
 * Caso de uso: Validar y consumir código QR de un solo uso (RF-8.3, RF-6.4, RNF-08)
 *
 * Reglas de negocio:
 * 1. Token o tripId faltantes => 400 Bad Request.
 * 2. Token inexistente en persistencia y caché => 404 Not Found.
 * 3. Token no correspondiente al viaje indicado => 400 Bad Request.
 * 4. Token ya consumido previamente o expirado => 410 Gone.
 * 5. Consumo atómico (RNF-08):
 *    Se ejecuta markAsUsed condicionalmente sobre la persistencia. Si dos solicitudes
 *    concurrentes intentan validar el mismo token simultáneamente, el motor garantiza
 *    que solo una consiga count > 0; la perdedora recibe false y lanza 410 Gone.
 * 6. Se elimina la clave en Redis con getDel para invalidar la caché inmediatamente.
 */
@Injectable()
export class VerifyQrUseCase {
  private readonly logger = new Logger(VerifyQrUseCase.name);

  constructor(
    @Inject(QR_TOKEN_REPOSITORY_PORT)
    private readonly qrTokenRepo: QrTokenRepositoryPort,
    private readonly redis: RedisService,
  ) {}

  async execute(dto: VerifyQrDto): Promise<VerifyQrResult> {
    const token = dto.token?.trim();
    const tripId = dto.tripId?.trim();

    if (!token || !tripId) {
      throw new BadRequestException('Token y tripId son obligatorios.');
    }

    // 1. Consultar persistencia
    const tokenRecord = await this.qrTokenRepo.findByToken(token);

    // Si no está en BD, consultar caché efímera de Redis
    let cachedData: any = null;
    if (!tokenRecord) {
      const cached = await this.redis.get(`qr:${token}`);
      if (cached) {
        try {
          cachedData = JSON.parse(cached);
        } catch {
          // Ignorar error de parsing en caché corrupta
        }
      }
    }

    // Si no existe en ninguna fuente => 404 Not Found
    if (!tokenRecord && !cachedData) {
      throw new NotFoundException('Código QR no encontrado o inválido.');
    }

    // 2. Validar pertenencia del viaje
    const expectedTripId = tokenRecord?.tripId ?? cachedData?.tripId;
    if (expectedTripId !== tripId) {
      throw new BadRequestException('El código QR no corresponde a este viaje.');
    }

    // 3. Validar estado de uso previo
    if (tokenRecord?.isUsed || cachedData?.isUsed) {
      throw new GoneException(
        'El código QR ya fue utilizado anteriormente (código de un solo uso consumido).',
      );
    }

    // 4. Validar expiración (TTL)
    const expiresAt = tokenRecord
      ? new Date(tokenRecord.expiresAt)
      : new Date(cachedData.expiresAt);

    if (new Date() > expiresAt) {
      throw new GoneException('El código QR ha expirado (tiempo de validez agotado).');
    }

    // 5. Consumo atómico contra condiciones de carrera (RNF-08)
    const usedAt = new Date();
    const consumed = await this.qrTokenRepo.markAsUsed(token, usedAt);

    if (!consumed) {
      throw new GoneException(
        'El código QR ya fue utilizado anteriormente (código de un solo uso consumido).',
      );
    }

    // 6. Eliminar clave activa de Redis para invalidación atómica inmediata
    await this.redis.getDel(`qr:${token}`);

    this.logger.log(`QR verificado y consumido exitosamente para viaje ${tripId}`);

    return {
      valid: true,
      tripId,
      token,
      verifiedAt: usedAt.toISOString(),
      message: 'Código QR verificado exitosamente. Inicio de viaje habilitado.',
    };
  }
}
