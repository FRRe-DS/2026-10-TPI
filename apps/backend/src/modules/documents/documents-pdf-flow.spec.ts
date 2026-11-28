import * as net from 'net';
import * as zlib from 'zlib';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import type { Response } from 'superagent';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma.service';
import { ProblemDetailsFilter } from '../../common/problem-details.filter';
import { RedisService } from '../../common/redis.service';
import {
  NotificationLogRecord,
  NotificationLogRepositoryPort,
  UpdateNotificationLog,
} from '../notifications/domain/ports/notification-log.repository.port';
import { TripCompletedConsumer } from '../notifications/infrastructure/messaging/trip-completed.consumer';
import {
  RECEIPT_REPOSITORY_PORT,
  ReceiptData,
  ReceiptRecord,
  ReceiptRepositoryPort,
} from './domain/ports/receipt.repository.port';
import { PdfKitReceiptPdfAdapter } from './infrastructure/adapters/pdfkit-receipt-pdf.adapter';

/**
 * Prueba de integración HTTP + PDFKit + Nodemailer sobre SMTP local en memoria (RF-8.4 y RF-8.5).
 *
 * Qué es REAL en esta suite (no usa mocks en el camino crítico):
 *  - App NestJS completa (AppModule, ValidationPipe, ProblemDetailsFilter, prefijo /api/v1).
 *  - Controladores HTTP (EventsController y DocumentsController) ejercitados con Supertest.
 *  - Casos de uso (IssueReceiptUseCase, RegisterReceiptUseCase, GenerateReceiptPdfUseCase,
 *    ResendReceiptUseCase, SendNotificationUseCase) y servicio NotificationsService.
 *  - PdfKitReceiptPdfAdapter (generación real de PDF con PDFKit).
 *  - NodemailerEmailAdapter transmitiendo por TCP/SMTP a un servidor ESMTP local efímero
 *    (`127.0.0.1:<puerto aleatorio>`) que captura el mensaje MIME íntegro.
 *
 * Qué usa dobles en memoria (para correr sin Docker ni Supabase):
 *  - Repositorio de comprobantes y repositorio de logs de notificaciones en memoria.
 *  - Redis y consumidor RabbitMQ anulados.
 */

function makeJwt(payload: { sub: string; rol: string }): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `Bearer ${header}.${body}.test-signature`;
}

function binaryParser(res: Response, callback: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.setEncoding('binary');
  res.on('data', (chunk: string) => chunks.push(Buffer.from(chunk, 'binary')));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

function extractPdfText(buf: Buffer): string {
  const latin = buf.toString('latin1');
  const lines: string[] = [];
  const re = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(latin))) {
    const start = match.index + match[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    try {
      const content = zlib.inflateSync(buf.subarray(start, end)).toString('latin1');
      for (const tj of content.matchAll(/\[(.*?)\]\s*TJ/gs)) {
        let line = '';
        for (const h of tj[1].matchAll(/<([0-9a-fA-F]+)>/g)) {
          line += Buffer.from(h[1], 'hex').toString('latin1');
        }
        lines.push(line);
      }
      for (const t of content.matchAll(/\((.*?)\)\s*Tj/g)) {
        lines.push(t[1]);
      }
    } catch {
      // Ignorar streams no comprimidos con Flate
    }
  }
  return lines.join('\n');
}

/** Extrae el adjunto PDF de un mensaje MIME crudo recibido por SMTP. */
function extractMimePdfAttachment(rawMime: string): {
  filename: string;
  contentType: string;
  buffer: Buffer;
} {
  const boundaryMatch = rawMime.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!boundaryMatch) {
    throw new Error('El mensaje MIME no contiene multipart boundary.');
  }
  const boundary = `--${boundaryMatch[1]}`;
  const parts = rawMime.split(boundary);

  for (const part of parts) {
    const sepIndex = part.indexOf('\r\n\r\n');
    if (sepIndex < 0) continue;
    const rawHeaders = part.slice(0, sepIndex);
    if (!/Content-Type:\s*application\/pdf/i.test(rawHeaders)) continue;

    const filenameMatch =
      rawHeaders.match(/filename="?([^"\r\n;]+)"?/i) ??
      rawHeaders.match(/name="?([^"\r\n;]+)"?/i);
    const contentTypeMatch = rawHeaders.match(/Content-Type:\s*([^\r\n;]+)/i);
    const bodyBase64 = part
      .slice(sepIndex + 4)
      .replace(/--\s*$/, '')
      .replace(/\s+/g, '');

    return {
      filename: filenameMatch ? filenameMatch[1] : '',
      contentType: contentTypeMatch ? contentTypeMatch[1].trim() : '',
      buffer: Buffer.from(bodyBase64, 'base64'),
    };
  }

  throw new Error('No se encontró una parte MIME con Content-Type: application/pdf.');
}

interface SmtpSink {
  port: number;
  messages: Array<{ envelopeTo: string[]; raw: string }>;
  close(): Promise<void>;
}

async function startLocalSmtpSink(): Promise<SmtpSink> {
  const messages: Array<{ envelopeTo: string[]; raw: string }> = [];

  const server = net.createServer((socket) => {
    let mode: 'cmd' | 'data' = 'cmd';
    let buffer = '';
    let rcptTo: string[] = [];

    socket.write('220 127.0.0.1 ESMTP local-test-sink\r\n');

    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      for (;;) {
        if (mode === 'cmd') {
          const idx = buffer.indexOf('\r\n');
          if (idx < 0) break;
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const upper = line.toUpperCase();

          if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
            socket.write('250 127.0.0.1\r\n');
          } else if (upper.startsWith('MAIL FROM')) {
            rcptTo = [];
            socket.write('250 OK\r\n');
          } else if (upper.startsWith('RCPT TO:')) {
            const addr = line.slice(8).replace(/[<>\s]/g, '');
            rcptTo.push(addr);
            socket.write('250 OK\r\n');
          } else if (upper.startsWith('DATA')) {
            mode = 'data';
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          } else if (upper.startsWith('QUIT')) {
            socket.write('221 Bye\r\n');
            socket.end();
            return;
          } else {
            socket.write('250 OK\r\n');
          }
        } else {
          const endIdx = buffer.indexOf('\r\n.\r\n');
          if (endIdx < 0) break;
          const raw = buffer.slice(0, endIdx).replace(/^\.\./gm, '.');
          buffer = buffer.slice(endIdx + 5);
          mode = 'cmd';
          messages.push({ envelopeTo: [...rcptTo], raw });
          socket.write('250 OK queued\r\n');
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as net.AddressInfo;

  return {
    port: address.port,
    messages,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

class InMemoryReceiptRepository implements ReceiptRepositoryPort {
  readonly byTrip = new Map<string, ReceiptRecord>();
  fixedIssuedAt = new Date('2026-10-17T18:32:21.711Z');
  private seq = 0;

  async save(data: ReceiptData): Promise<ReceiptRecord> {
    const existing = this.byTrip.get(data.tripId);
    if (existing) return existing;

    this.seq++;
    const record: ReceiptRecord = {
      id: `11111111-2222-4333-8444-${String(this.seq).padStart(12, '0')}`,
      receiptCode: `REC-2026-IT${String(this.seq).padStart(4, '0')}`,
      tripId: data.tripId,
      passengerId: data.passengerId,
      passengerEmail: data.passengerEmail,
      amount: data.amount,
      currency: data.currency ?? 'ARS',
      driverName: data.driverName,
      issuedAt: this.fixedIssuedAt,
    };
    this.byTrip.set(data.tripId, record);
    return record;
  }

  async findByTripId(tripId: string): Promise<ReceiptRecord | null> {
    return this.byTrip.get(tripId) ?? null;
  }

  async findByIdOrTripId(idOrTripId: string): Promise<ReceiptRecord | null> {
    for (const r of this.byTrip.values()) {
      if (r.id === idOrTripId) return r;
    }
    for (const r of this.byTrip.values()) {
      if (r.receiptCode === idOrTripId || r.tripId === idOrTripId) return r;
    }
    return null;
  }

  async findMany(filters?: {
    viajeId?: string;
    pagoId?: string;
    clienteId?: string;
  }): Promise<ReceiptRecord[]> {
    return Array.from(this.byTrip.values()).filter((r) => {
      if (filters?.viajeId && r.tripId !== filters.viajeId) return false;
      if (filters?.clienteId && r.passengerId !== filters.clienteId) return false;
      return true;
    });
  }
}

class InMemoryNotificationLogRepository extends NotificationLogRepositoryPort {
  readonly logs: NotificationLogRecord[] = [];
  private seq = 0;

  async findByEventId(eventId: string): Promise<NotificationLogRecord | null> {
    return this.logs.find((l) => l.eventId === eventId) ?? null;
  }

  async findById(id: string): Promise<NotificationLogRecord | null> {
    return this.logs.find((l) => l.id === id) ?? null;
  }

  async create(input: any): Promise<NotificationLogRecord> {
    this.seq++;
    const now = new Date();
    const record: NotificationLogRecord = {
      id: `notif-log-${this.seq}`,
      eventId: input.eventId ?? null,
      channel: input.channel,
      recipient: input.recipient,
      subject: input.subject,
      content: input.content,
      status: input.status,
      retryCount: input.retryCount,
      lastError: input.lastError ?? null,
      referenceId: input.referenceId ?? null,
      referenceType: input.referenceType ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.logs.push(record);
    return record;
  }

  async update(id: string, input: UpdateNotificationLog): Promise<Pick<NotificationLogRecord, 'id'>> {
    const existing = this.logs.find((l) => l.id === id);
    if (existing) {
      existing.status = input.status;
      existing.retryCount = input.retryCount;
      existing.lastError = input.lastError;
      existing.updatedAt = new Date();
    }
    return { id };
  }

  async findMany(): Promise<NotificationLogRecord[]> {
    return [...this.logs];
  }
}

describe('Flujo HTTP completo RF-8.4 y RF-8.5 (PDFKit + Nodemailer sobre ESMTP local)', () => {
  let smtp: SmtpSink;
  let app: INestApplication;
  let receiptRepo: InMemoryReceiptRepository;
  let savedSmtpEnv: Record<string, string | undefined>;

  const serviceToken = makeJwt({ sub: 'm6-viajes', rol: 'SERVICIO' });
  const clientToken = makeJwt({ sub: '33333333-3333-4333-8333-333333333333', rol: 'CLIENTE' });
  const otherClientToken = makeJwt({ sub: '99999999-9999-4999-8999-999999999999', rol: 'CLIENTE' });

  beforeAll(async () => {
    smtp = await startLocalSmtpSink();
    savedSmtpEnv = {
      SMTP_HOST: process.env.SMTP_HOST,
      SMTP_PORT: process.env.SMTP_PORT,
      SMTP_SECURE: process.env.SMTP_SECURE,
      SMTP_USER: process.env.SMTP_USER,
      SMTP_PASS: process.env.SMTP_PASS,
    };
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(smtp.port);
    process.env.SMTP_SECURE = 'false';
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    receiptRepo = new InMemoryReceiptRepository();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn(), $queryRaw: jest.fn() })
      .overrideProvider(RedisService)
      .useValue({
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        del: jest.fn().mockResolvedValue(undefined),
        getDel: jest.fn().mockResolvedValue(null),
        ping: jest.fn().mockResolvedValue(true),
      })
      .overrideProvider(TripCompletedConsumer)
      .useValue({})
      .overrideProvider(RECEIPT_REPOSITORY_PORT)
      .useValue(receiptRepo)
      .overrideProvider(NotificationLogRepositoryPort)
      .useValue(new InMemoryNotificationLogRepository())
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
  });

  beforeEach(() => {
    smtp.messages.length = 0;
    receiptRepo.byTrip.clear();
  });

  afterAll(async () => {
    await app?.close();
    await smtp?.close();
    for (const [k, v] of Object.entries(savedSmtpEnv ?? {})) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('RF-8.4: confirmar el viaje en POST /api/v1/eventos genera automáticamente el PDF, lo adjunta por SMTP y es idempotente ante eventos repetidos', async () => {
    const tripId = '22222222-2222-4222-8222-222222222222';
    const eventBody = {
      eventoId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tipo: 'VIAJE_FINALIZADO',
      origen: 'M6',
      ocurridoEn: '2026-10-17T18:32:21.711Z',
      viajeId: tripId,
      destinatarios: [
        {
          usuarioId: '33333333-3333-4333-8333-333333333333',
          rol: 'CLIENTE',
          email: 'cliente.viaje@ejemplo.com',
          canalesPreferidos: ['EMAIL'],
        },
      ],
      detalle: {
        origen: 'Av. 9 de Julio 1200',
        destino: 'UTN FRRe',
        importe: { monto: 4850.5, moneda: 'ARS' },
      },
    };

    const first = await request(app.getHttpServer())
      .post('/api/v1/eventos')
      .set('Authorization', serviceToken)
      .send(eventBody)
      .expect(202);

    // Repetición del mismo evento y luego un PAGO_CAPTURADO del mismo viaje: no duplican el comprobante.
    const repeatSameEvent = await request(app.getHttpServer())
      .post('/api/v1/eventos')
      .set('Authorization', serviceToken)
      .send(eventBody)
      .expect(202);
    expect(repeatSameEvent.body).toEqual(first.body);

    await request(app.getHttpServer())
      .post('/api/v1/eventos')
      .set('Authorization', serviceToken)
      .send({
        ...eventBody,
        eventoId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        tipo: 'PAGO_CAPTURADO',
        origen: 'M7',
        pagoId: '44444444-4444-4444-8444-444444444444',
      })
      .expect(202);

    expect(receiptRepo.byTrip.size).toBe(1);
    expect(smtp.messages).toHaveLength(2); // 1 por VIAJE_FINALIZADO + 1 por PAGO_CAPTURADO (el repetido se filtró)

    // El primer mensaje ya lleva el PDF generado automáticamente al confirmar el viaje, sin haber descargado ni reenviado.
    const attachment = extractMimePdfAttachment(smtp.messages[0].raw);
    expect(attachment.contentType.toLowerCase()).toBe('application/pdf');
    expect(attachment.filename).toMatch(/^comprobante-REC-2026-.*\.pdf$/);
    expect(attachment.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(attachment.buffer.toString('latin1')).toContain('%%EOF');
    expect(extractPdfText(attachment.buffer)).toContain('Total abonado: ARS 4850.50');

    // El segundo mensaje (PAGO_CAPTURADO del mismo viaje) informa el pago sin duplicar comprobante ni reenviar el PDF dos veces.
    expect(/Content-Type:\s*application\/pdf/i.test(smtp.messages[1].raw)).toBe(false);
  });

  it('RF-8.4: GET /api/v1/comprobantes/{id}/pdf descarga un PDF válido (%PDF-) por comprobanteId y responde 404 / 403 según el contrato', async () => {
    const tripId = '55555555-5555-4555-8555-555555555555';
    await request(app.getHttpServer())
      .post('/api/v1/eventos')
      .set('Authorization', serviceToken)
      .send({
        eventoId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        tipo: 'VIAJE_FINALIZADO',
        origen: 'M6',
        ocurridoEn: '2026-10-17T18:32:21.711Z',
        viajeId: tripId,
        destinatarios: [
          {
            usuarioId: '33333333-3333-4333-8333-333333333333',
            rol: 'CLIENTE',
            email: 'cliente.pdf@ejemplo.com',
          },
        ],
        detalle: { importe: { monto: 3900, moneda: 'ARS' } },
      })
      .expect(202);

    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/comprobantes?viajeId=${tripId}`)
      .set('Authorization', clientToken)
      .expect(200);
    expect(listRes.body.items).toHaveLength(1);
    const comprobanteId: string = listRes.body.items[0].comprobanteId;
    const codigo: string = listRes.body.items[0].codigoComprobante;

    const pdfRes = await request(app.getHttpServer())
      .get(`/api/v1/comprobantes/${comprobanteId}/pdf`)
      .set('Authorization', clientToken)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.headers['content-disposition']).toContain(`comprobante-${codigo}.pdf`);
    const pdfBuffer = pdfRes.body as Buffer;
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdfBuffer.toString('latin1')).toContain('%%EOF');
    const pdfText = extractPdfText(pdfBuffer);
    expect(pdfText).toContain(`ID de viaje: ${tripId}`);
    expect(pdfText).toContain('Fecha de emisión: 17/10/2026, 15:32:21');
    expect(pdfText).toContain('Total abonado: ARS 3900.00');

    // Otro cliente no puede descargar el PDF ajeno (403).
    await request(app.getHttpServer())
      .get(`/api/v1/comprobantes/${comprobanteId}/pdf`)
      .set('Authorization', otherClientToken)
      .expect(403);

    // Un comprobante inexistente devuelve 404 Problem Details.
    const notFound = await request(app.getHttpServer())
      .get('/api/v1/comprobantes/00000000-0000-4000-8000-000000000000/pdf')
      .set('Authorization', clientToken)
      .expect(404);
    expect(notFound.headers['content-type']).toContain('application/problem+json');
  });

  it('RF-8.5: POST /api/v1/comprobantes/{id}/reenvios entrega por Nodemailer un adjunto PDF válido conservando la fecha de emisión original', async () => {
    const saved = await receiptRepo.save({
      tripId: '66666666-6666-4666-8666-666666666666',
      passengerId: '33333333-3333-4333-8333-333333333333',
      passengerEmail: 'registrado.oficial@ejemplo.com',
      amount: 5120.25,
      currency: 'ARS',
      driverName: 'Conductora Ana',
    });

    const resendRes = await request(app.getHttpServer())
      .post(`/api/v1/comprobantes/${saved.id}/reenvios`)
      .set('Authorization', clientToken)
      .set('Idempotency-Key', 'idem-rf85-001')
      .send({ canal: 'EMAIL' })
      .expect(202);

    expect(resendRes.body).toMatchObject({
      canal: 'EMAIL',
      estado: 'ENVIADA',
      destinatarioId: saved.passengerId,
      comprobanteId: saved.id,
      codigoComprobante: saved.receiptCode,
    });

    expect(smtp.messages).toHaveLength(1);
    expect(smtp.messages[0].envelopeTo).toEqual(['registrado.oficial@ejemplo.com']);

    const attachment = extractMimePdfAttachment(smtp.messages[0].raw);
    expect(attachment.filename).toBe(`comprobante-${saved.receiptCode}.pdf`);
    expect(attachment.contentType.toLowerCase()).toBe('application/pdf');
    expect(attachment.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(attachment.buffer.toString('latin1')).toContain('%%EOF');

    const text = extractPdfText(attachment.buffer);
    expect(text).toContain('COMPROBANTE DE VIAJE');
    expect(text).toContain('Fecha de emisión: 17/10/2026, 15:32:21'); // fecha original conservada
    expect(text).toContain('Conductor: Conductora Ana');
    expect(text).toContain('Total abonado: ARS 5120.25');

    // No se permite indicar un email arbitrario en el cuerpo (additionalProperties: false -> 400) ni omitir canal (required -> 400).
    await request(app.getHttpServer())
      .post(`/api/v1/comprobantes/${saved.id}/reenvios`)
      .set('Authorization', clientToken)
      .set('Idempotency-Key', 'idem-rf85-002')
      .send({ canal: 'EMAIL', emailDestino: 'intruso@ejemplo.com' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/comprobantes/${saved.id}/reenvios`)
      .set('Authorization', clientToken)
      .set('Idempotency-Key', 'idem-rf85-003')
      .send({})
      .expect(400);
    expect(smtp.messages).toHaveLength(1);

    // Control de acceso en descarga y reenvío al resolver por UUID, receiptCode o tripId
    // (incluso intentando reutilizar el mismo Idempotency-Key del propietario legítimo).
    for (const identifier of [saved.id, saved.receiptCode, saved.tripId]) {
      await request(app.getHttpServer())
        .get(`/api/v1/comprobantes/${encodeURIComponent(identifier)}/pdf`)
        .set('Authorization', otherClientToken)
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/comprobantes/${encodeURIComponent(identifier)}/reenvios`)
        .set('Authorization', otherClientToken)
        .set('Idempotency-Key', 'idem-rf85-001')
        .send({ canal: 'EMAIL' })
        .expect(403);
    }
    expect(smtp.messages).toHaveLength(1);
  });

  it('RF-8.4 / RF-8.5: si PDFKit falla durante la confirmación del viaje, el comprobante queda registrado y el PDF se recupera en descarga y reenvío', async () => {
    const tripId = '77777777-8888-4999-8aaa-bbbbbbbbbbbb';
    const generateSpy = jest
      .spyOn(PdfKitReceiptPdfAdapter.prototype, 'generate')
      .mockRejectedValueOnce(new Error('Fallo transitorio simulado en PDFKit'));

    try {
      const eventPayload = {
        eventoId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        tipo: 'VIAJE_FINALIZADO',
        origen: 'M6',
        ocurridoEn: '2026-10-17T18:32:21.711Z',
        viajeId: tripId,
        destinatarios: [
          {
            usuarioId: '33333333-3333-4333-8333-333333333333',
            rol: 'CLIENTE',
            email: 'recuperacion.pdf@ejemplo.com',
          },
        ],
        detalle: { importe: { monto: 4100, moneda: 'ARS' } },
      };

      await request(app.getHttpServer())
        .post('/api/v1/eventos')
        .set('Authorization', serviceToken)
        .send(eventPayload)
        .expect(202);

      // El evento quedó marcado como procesado y el comprobante persistido (1 aviso sin adjunto corrupto).
      expect(receiptRepo.byTrip.size).toBe(1);
      expect(smtp.messages).toHaveLength(1);
      expect(/Content-Type:\s*application\/pdf/i.test(smtp.messages[0].raw)).toBe(false);
    } finally {
      generateSpy.mockRestore();
    }

    const persisted = (await receiptRepo.findByTripId(tripId))!;
    expect(persisted).toBeDefined();

    // Recuperación 1: descarga posterior en GET /api/v1/comprobantes/{id}/pdf genera el PDF válido con la fecha original.
    const pdfRes = await request(app.getHttpServer())
      .get(`/api/v1/comprobantes/${persisted.id}/pdf`)
      .set('Authorization', clientToken)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    const downloadedBuffer = pdfRes.body as Buffer;
    expect(downloadedBuffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(extractPdfText(downloadedBuffer)).toContain('Fecha de emisión: 17/10/2026, 15:32:21');

    // Recuperación 2: reenvío posterior en POST /api/v1/comprobantes/{id}/reenvios adjunta el PDF válido por SMTP.
    smtp.messages.length = 0;
    await request(app.getHttpServer())
      .post(`/api/v1/comprobantes/${persisted.id}/reenvios`)
      .set('Authorization', clientToken)
      .set('Idempotency-Key', 'idem-recover-001')
      .send({ canal: 'EMAIL' })
      .expect(202);

    expect(smtp.messages).toHaveLength(1);
    const recoveredAttachment = extractMimePdfAttachment(smtp.messages[0].raw);
    expect(recoveredAttachment.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(extractPdfText(recoveredAttachment.buffer)).toContain('Total abonado: ARS 4100.00');
  });
});
