import {
  Injectable,
  Logger,
  NotFoundException,
  GoneException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { GenerateQrDto, VerifyQrDto, ResendReceiptDto } from './dto/documents.dto';
import { RedisService } from '../../../common/redis.service';
import { PrismaService } from '../../../common/prisma.service';
import { NotificationsService } from '../../notifications/application/notifications.service';
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
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    @Inject(RECEIPT_REPOSITORY_PORT)
    private readonly receiptRepo: ReceiptRepositoryPort,
    private readonly resendReceiptUseCase: ResendReceiptUseCase,
  ) {}

  // ─── QR (RF-8.3 / RF-6.4) ───────────────────────────────────────────────────

  // Fallback en memoria en caso de desarrollo offline sin conexión a Supabase
  private readonly memoryTokens = new Map<
    string,
    {
      token: string;
      tripId: string;
      passengerId: string;
      expiresAt: Date;
      isUsed: boolean;
      usedAt?: Date;
    }
  >();

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
      isUsed: false,
    });

    // 1. Guardar en memoria de respaldo
    this.memoryTokens.set(token, {
      token,
      tripId: dto.tripId,
      passengerId: dto.passengerId,
      expiresAt,
      isUsed: false,
    });

    // 2. Almacenar en Redis con TTL para acceso rápido y expiración automática
    await this.redis.set(`qr:${token}`, payload, ttl);

    // 3. Almacenar en Supabase / PostgreSQL (Prisma) para persistencia y trazabilidad
    try {
      await this.prisma.qrVerificationToken.create({
        data: {
          token,
          tripId: dto.tripId,
          passengerId: dto.passengerId,
          expiresAt,
          isUsed: false,
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `No se pudo persistir QrVerificationToken en base de datos: ${err.message}`,
      );
    }

    // 4. Renderizar código QR en base64 (DataURL)
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
    const token = dto.token?.trim();
    const tripId = dto.tripId?.trim();

    // 1. Consultar en Redis primero (caché de estado efímero y TTL)
    const cached = token ? await this.redis.get(`qr:${token}`) : null;

    // 2. Consultar en base de datos (Prisma / Supabase) para trazabilidad de uso/expiración
    let tokenRecord: any = null;
    try {
      tokenRecord = await this.prisma.qrVerificationToken.findUnique({
        where: { token },
      });
    } catch (err: any) {
      this.logger.warn(
        `Error consultando QrVerificationToken en base de datos: ${err.message}`,
      );
    }

    // 3. Si la base no respondió o no lo tiene, consultar memoria de respaldo
    if (!tokenRecord && token && this.memoryTokens.has(token)) {
      tokenRecord = this.memoryTokens.get(token);
    }

    // Si no existe en ninguna fuente => 404 Not Found
    if (!tokenRecord && !cached) {
      throw new NotFoundException('Código QR no encontrado o inválido.');
    }

    // 4. Validar reglas de negocio con el registro encontrado
    if (tokenRecord) {
      if (tokenRecord.tripId !== tripId) {
        throw new BadRequestException('El código QR no corresponde a este viaje.');
      }

      if (tokenRecord.isUsed) {
        throw new GoneException(
          'El código QR ya fue utilizado anteriormente (código de un solo uso consumido).',
        );
      }

      if (new Date() > new Date(tokenRecord.expiresAt)) {
        throw new GoneException('El código QR ha expirado (tiempo de validez agotado).');
      }
    } else if (cached) {
      const data = JSON.parse(cached);
      if (data.tripId !== tripId) {
        throw new BadRequestException('El código QR no corresponde a este viaje.');
      }
      if (data.isUsed) {
        throw new GoneException('El código QR ya fue utilizado anteriormente.');
      }
      if (new Date() > new Date(data.expiresAt)) {
        throw new GoneException('El código QR ha expirado (tiempo de validez agotado).');
      }
    }

    // 5. Marcar como consumido (isUsed: true, usedAt: now)
    const usedAt = new Date();

    // Actualizar en memoria local
    if (token && this.memoryTokens.has(token)) {
      const mem = this.memoryTokens.get(token)!;
      mem.isUsed = true;
      mem.usedAt = usedAt;
    }

    // Actualizar en base de datos
    try {
      await this.prisma.qrVerificationToken.update({
        where: { token },
        data: {
          isUsed: true,
          usedAt,
        },
      });
    } catch (err: any) {
      this.logger.warn(`Error actualizando estado isUsed en base de datos: ${err.message}`);
    }

    // 6. Eliminar clave activa de Redis para invalidación atómica
    if (token) {
      await this.redis.del(`qr:${token}`);
    }

    this.logger.log(`QR verificado y consumido exitosamente para viaje ${tripId}`);

    return {
      valid: true,
      tripId: tripId || dto.tripId,
      token: token || dto.token,
      verifiedAt: usedAt.toISOString(),
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
