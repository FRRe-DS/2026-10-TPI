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
      throw new NotFoundException('Código QR inválido o expirado (TTL vencido o ya utilizado).');
    }

    const data = JSON.parse(cached);
    if (data.tripId !== dto.tripId) {
      throw new BadRequestException('El código QR no corresponde a este viaje.');
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
