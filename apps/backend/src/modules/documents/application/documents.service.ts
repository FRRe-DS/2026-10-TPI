import { Injectable, Logger, NotFoundException, GoneException, BadRequestException } from '@nestjs/common';
import { GenerateQrDto, VerifyQrDto, ResendReceiptDto } from './dto/documents.dto';
import { RedisService } from '../../../common/redis.service';
import { PrismaService } from '../../../common/prisma.service';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { NotificationChannelDto } from '../../notifications/application/dto/send-notification.dto';
import * as QRCode from 'qrcode';
import * as PDFDocument from 'pdfkit';
import * as crypto from 'crypto';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) { }

  // Fallback en memoria en caso de desarrollo offline sin conexión a Supabase
  private readonly memoryTokens = new Map<string, {
    token: string;
    tripId: string;
    passengerId: string;
    expiresAt: Date;
    isUsed: boolean;
    usedAt?: Date;
  }>();

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
    } catch (err) {
      this.logger.warn(`No se pudo persistir QrVerificationToken en base de datos: ${err.message}`);
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

    // 1. Consultar en base de datos (Prisma / Supabase)
    let tokenRecord: any = null;
    try {
      tokenRecord = await this.prisma.qrVerificationToken.findUnique({
        where: { token },
      });
    } catch (err) {
      this.logger.warn(`Error consultando QrVerificationToken en base de datos: ${err.message}`);
    }

    // 2. Si la base no respondió o no lo tiene, consultar memoria de respaldo
    if (!tokenRecord && token && this.memoryTokens.has(token)) {
      tokenRecord = this.memoryTokens.get(token);
    }

    // 3. Consultar en Redis
    const cached = token ? await this.redis.get(`qr:${token}`) : null;

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
        throw new GoneException('El código QR ya fue utilizado anteriormente (código de un solo uso consumido).');
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
    } catch (err) {
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

  async generateReceiptPdfBuffer(data: {
    tripId: string;
    passengerEmail: string;
    amount: number;
    currency: string;
    driverName?: string;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40 });
      const buffers: Buffer[] = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      doc.fontSize(20).text('COMPROBANTE DE VIAJE', { align: 'center' });
      doc.fontSize(10).text('Plataforma de Movilidad Urbana - Módulo 8', { align: 'center' });
      doc.moveDown(2);

      doc.fontSize(12).text(`ID de Viaje: ${data.tripId}`);
      doc.text(`Fecha: ${new Date().toLocaleString()}`);
      doc.text(`Pasajero: ${data.passengerEmail}`);
      if (data.driverName) doc.text(`Conductor: ${data.driverName}`);
      doc.moveDown();

      doc.font('Helvetica-Bold').fontSize(14).text(`Total Abonado: ${data.currency} $${data.amount.toFixed(2)}`);
      doc.moveDown(2);

      doc.font('Helvetica').fontSize(9).fillColor('#555555').text('Comprobante digital oficial de viaje.', { align: 'center' });
      doc.end();
    });
  }

  async resendReceipt(dto: ResendReceiptDto) {
    this.logger.log(`Reenvío de comprobante para viaje ${dto.tripId} a ${dto.email}`);
    await this.notificationsService.send({
      channel: NotificationChannelDto.EMAIL,
      recipient: dto.email,
      subject: `Comprobante de Viaje #${dto.tripId}`,
      content: `Estimado/a, adjuntamos el acceso a su comprobante oficial correspondiente al viaje #${dto.tripId}.`,
      referenceId: dto.tripId,
      referenceType: 'TRIP',
    });

    return {
      success: true,
      tripId: dto.tripId,
      sentTo: dto.email,
      timestamp: new Date().toISOString(),
    };
  }
}
