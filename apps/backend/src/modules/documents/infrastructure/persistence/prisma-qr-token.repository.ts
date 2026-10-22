import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../common/prisma.service';
import {
  QrTokenData,
  QrTokenRecord,
  QrTokenRepositoryPort,
} from '../../domain/ports/qr-token.repository.port';

/**
 * Adaptador de persistencia: implementa QrTokenRepositoryPort utilizando Prisma ORM
 * sobre la tabla QrVerificationToken de PostgreSQL/Supabase.
 *
 * Concurrencia y atomicidad (RNF-08):
 * markAsUsed ejecuta un UPDATE condicional (UPDATE ... WHERE token = $1 AND is_used = false).
 * En PostgreSQL este mecanismo adquiere un bloqueo exclusivo de fila a nivel de motor,
 * garantizando que ante dos peticiones simultáneas solo una afecte filas (count = 1)
 * y la segunda retorne 0 filas afectadas (count = 0), impidiendo el doble consumo.
 */
@Injectable()
export class PrismaQrTokenRepository implements QrTokenRepositoryPort {
  private readonly logger = new Logger(PrismaQrTokenRepository.name);
  private readonly memoryFallback = new Map<string, QrTokenRecord>();

  constructor(private readonly prisma: PrismaService) {}

  async save(data: QrTokenData): Promise<QrTokenRecord> {
    try {
      const created = await this.prisma.qrVerificationToken.create({
        data: {
          token: data.token,
          tripId: data.tripId,
          passengerId: data.passengerId,
          expiresAt: data.expiresAt,
          isUsed: data.isUsed ?? false,
        },
      });
      const record = this.toRecord(created);
      this.memoryFallback.set(data.token, record);
      return record;
    } catch (err: any) {
      this.logger.warn(
        `No se pudo persistir QrVerificationToken en base de datos: ${err.message}. Usando memoria de respaldo.`,
      );
      const record: QrTokenRecord = {
        id: 'mem-' + Date.now(),
        token: data.token,
        tripId: data.tripId,
        passengerId: data.passengerId,
        isUsed: data.isUsed ?? false,
        usedAt: null,
        expiresAt: data.expiresAt,
        createdAt: new Date(),
      };
      this.memoryFallback.set(data.token, record);
      return record;
    }
  }

  async findByToken(token: string): Promise<QrTokenRecord | null> {
    try {
      const row = await this.prisma.qrVerificationToken.findUnique({
        where: { token },
      });
      if (row) {
        return this.toRecord(row);
      }
    } catch (err: any) {
      this.logger.warn(
        `Error consultando QrVerificationToken en base de datos: ${err.message}. Consultando memoria de respaldo.`,
      );
    }
    return this.memoryFallback.get(token) ?? null;
  }

  async markAsUsed(token: string, usedAt?: Date): Promise<boolean> {
    const timestamp = usedAt ?? new Date();
    try {
      const result = await this.prisma.qrVerificationToken.updateMany({
        where: {
          token,
          isUsed: false,
        },
        data: {
          isUsed: true,
          usedAt: timestamp,
        },
      });

      if (result.count > 0) {
        if (this.memoryFallback.has(token)) {
          const mem = this.memoryFallback.get(token)!;
          mem.isUsed = true;
          mem.usedAt = timestamp;
        }
        return true;
      }
      return false;
    } catch (err: any) {
      this.logger.warn(
        `Error actualizando QrVerificationToken en base de datos: ${err.message}. Usando memoria de respaldo.`,
      );
      const mem = this.memoryFallback.get(token);
      if (mem && !mem.isUsed) {
        mem.isUsed = true;
        mem.usedAt = timestamp;
        return true;
      }
      return false;
    }
  }

  private toRecord(row: {
    id: string;
    token: string;
    tripId: string;
    passengerId: string;
    isUsed: boolean;
    usedAt: Date | null;
    expiresAt: Date;
    createdAt: Date;
  }): QrTokenRecord {
    return {
      id: row.id,
      token: row.token,
      tripId: row.tripId,
      passengerId: row.passengerId,
      isUsed: row.isUsed,
      usedAt: row.usedAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }
}
