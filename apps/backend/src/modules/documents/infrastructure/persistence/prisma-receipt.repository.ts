import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../../common/prisma.service';
import {
  ReceiptData,
  ReceiptRecord,
  ReceiptRepositoryPort,
} from '../../domain/ports/receipt.repository.port';
import * as crypto from 'crypto';

/**
 * Adaptador de persistencia: implementa ReceiptRepositoryPort con Prisma ORM
 * sobre la tabla DocumentReceipt de PostgreSQL/Supabase.
 *
 * Idempotencia y concurrencia:
 * 1. Dado que tripId no posee una restricción @unique en el schema actual,
 *    se utiliza una transacción interactiva con un advisory lock exclusivo de PostgreSQL
 *    (pg_advisory_xact_lock) basado en el hash del tripId.
 *    Esto garantiza que solicitudes simultáneas para el MISMO tripId se sincronicen
 *    atómica y transparentemente sin crear filas duplicadas.
 * 2. Si ocurre una colisión del constraint @unique en receiptCode (código P2002 de Prisma),
 *    el reintento se realiza por FUERA de la transacción (reintentando la transacción completa).
 *    Esto es indispensable en PostgreSQL porque una transacción abortada por un error
 *    no permite ejecutar más comandos hasta cerrarse y reabrirse limpiamente.
 */
@Injectable()
export class PrismaReceiptRepository implements ReceiptRepositoryPort {
  private readonly logger = new Logger(PrismaReceiptRepository.name);
  private readonly MAX_ATTEMPTS = 3;

  constructor(private readonly prisma: PrismaService) {}

  async save(data: ReceiptData): Promise<ReceiptRecord> {
    for (let attempt = 1; attempt <= this.MAX_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // Bloqueo consultivo atómico exclusivo para este tripId a nivel de transacción PostgreSQL.
          // Se libera automáticamente al finalizar la transacción (COMMIT o ROLLBACK).
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'trip_receipt_' + data.tripId}))`;

          // Verificación dentro de la transacción protegida por el lock
          const existing = await tx.documentReceipt.findFirst({
            where: { tripId: data.tripId },
          });

          if (existing) {
            this.logger.log(
              `Comprobante ya existe para tripId=${data.tripId} (${existing.receiptCode}). Devolviendo existente.`,
            );
            return this.toRecord(existing);
          }

          const receiptCode = this.generateReceiptCode();

          const created = await tx.documentReceipt.create({
            data: {
              receiptCode,
              tripId: data.tripId,
              passengerId: data.passengerId,
              amount: data.amount,
              currency: data.currency ?? 'ARS',
              metadata: {
                passengerEmail: data.passengerEmail,
                driverName: data.driverName ?? null,
                ...(data.metadata ?? {}),
              },
            },
          });

          this.logger.log(
            `Comprobante creado exitosamente: ${created.receiptCode} para tripId=${data.tripId}`,
          );

          return this.toRecord(created);
        });
      } catch (error) {
        // En PostgreSQL, si create falla por P2002 la transacción queda en estado ABORTED.
        // Por eso el reintento se ubica aquí, por fuera del bloque $transaction,
        // reiniciando una transacción limpia desde cero.
        const isReceiptCodeCollision =
          error instanceof PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          this.isReceiptCodeTarget(error.meta);

        if (isReceiptCodeCollision && attempt < this.MAX_ATTEMPTS) {
          this.logger.warn(
            `Colisión de receiptCode en intento ${attempt}/${this.MAX_ATTEMPTS}. Reintentando transacción completa...`,
          );
          continue;
        }

        // Si se agotaron los intentos o fue un error diferente, relanzar
        throw error;
      }
    }

    throw new Error(
      `No se pudo generar un código único de comprobante tras ${this.MAX_ATTEMPTS} intentos.`,
    );
  }

  async findByTripId(tripId: string): Promise<ReceiptRecord | null> {
    const row = await this.prisma.documentReceipt.findFirst({
      where: { tripId },
    });
    return row ? this.toRecord(row) : null;
  }

  /**
   * Genera un código de comprobante con entropía criptográfica para evitar colisiones.
   * Formato: REC-YYYY-XXXXXX
   * Combina fragmento temporal base36 y 4 caracteres hexadecimales aleatorios.
   */
  private generateReceiptCode(): string {
    const year = new Date().getFullYear();
    const timePart = Date.now().toString(36).slice(-3).toUpperCase();
    const randPart = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `REC-${year}-${timePart}${randPart}`;
  }

  /**
   * Valida si el error P2002 de Prisma corresponde específicamente a receiptCode
   */
  private isReceiptCodeTarget(meta: unknown): boolean {
    if (!meta || typeof meta !== 'object') return true;
    const target = (meta as Record<string, unknown>)['target'];
    if (Array.isArray(target)) {
      return target.some((field) => String(field).includes('receiptCode'));
    }
    if (typeof target === 'string') {
      return target.includes('receiptCode');
    }
    return true;
  }

  private toRecord(row: {
    id: string;
    receiptCode: string;
    tripId: string | null;
    passengerId: string;
    amount: { toString(): string };
    currency: string;
    metadata: unknown;
    createdAt: Date;
  }): ReceiptRecord {
    const raw = row.metadata;
    const meta: Record<string, unknown> =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

    return {
      id: row.id,
      receiptCode: row.receiptCode,
      tripId: row.tripId ?? '',
      passengerId: row.passengerId,
      passengerEmail: (meta['passengerEmail'] as string) ?? '',
      amount: parseFloat(row.amount.toString()),
      currency: row.currency,
      driverName: (meta['driverName'] as string | undefined) ?? undefined,
      metadata: meta,
      issuedAt: row.createdAt,
    };
  }
}
