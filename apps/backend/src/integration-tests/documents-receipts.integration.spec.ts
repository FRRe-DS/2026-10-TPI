import { binaryParser, createIntegrationApp, IntegrationApp } from './support/integration-app';

/**
 * Pruebas de INTEGRACIÓN de comprobantes (RF-8.4): HTTP real contra una app NestJS,
 * con controladores, casos de uso, repositorio Prisma y PostgreSQL REALES (Testcontainers).
 * Requieren Docker: se ejecutan con `npm run test:integration`.
 *
 * Dobles de prueba (fuera de alcance): SMTP, Redis y RabbitMQ. El reenvío por correo
 * (RF-8.5) NO se prueba aquí.
 */
describe('Comprobantes PDF — API + Prisma + PostgreSQL temporal', () => {
  let ctx: IntegrationApp;
  let operatorJwt: string;
  let serviceJwt: string;

  const authed = (token?: string) => {
    const auth = token ?? operatorJwt;
    const agent = ctx.http();
    return {
      get: (url: string) => agent.get(url).set('Authorization', auth),
      post: (url: string) => agent.post(url).set('Authorization', auth),
    };
  };

  const RECEIPTS = '/api/v1/documents/receipts';
  const validBody = (tripId: string) => ({
    tripId,
    passengerId: 'usr-it-001',
    passengerEmail: 'pasajero.it@ejemplo.com',
    amount: 3500.5,
    currency: 'ARS',
    driverName: 'Conductor de Integración',
  });

  beforeAll(async () => {
    ctx = await createIntegrationApp();
    operatorJwt = ctx.issueBearerToken({ sub: 'operador-it-doc', role: 'OPERADOR' });
    serviceJwt = ctx.issueBearerToken({ sub: 'm6-viajes', role: 'SERVICIO' });
  }, 120_000);

  beforeEach(async () => {
    await ctx.database.reset();
    ctx.mailer.sent.length = 0;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('registra un comprobante: responde 201 y lo persiste realmente en PostgreSQL', async () => {
    const res = await authed().post(RECEIPTS).send(validBody('trip-it-register')).expect(201);

    expect(res.body).toEqual({
      id: expect.any(String),
      receiptCode: expect.stringMatching(/^REC-\d{4}-[0-9A-Z]{7}$/),
      tripId: 'trip-it-register',
      passengerId: 'usr-it-001',
      passengerEmail: 'pasajero.it@ejemplo.com',
      amount: 3500.5,
      currency: 'ARS',
      driverName: 'Conductor de Integración',
      issuedAt: expect.any(String),
    });

    const rows = await ctx.prisma.documentReceipt.findMany({ where: { tripId: 'trip-it-register' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(res.body.id);
    expect(rows[0].receiptCode).toBe(res.body.receiptCode);
    expect(Number(rows[0].amount)).toBe(3500.5);
    expect(rows[0].createdAt.toISOString()).toBe(res.body.issuedAt);
    expect(rows[0].metadata).toMatchObject({
      passengerEmail: 'pasajero.it@ejemplo.com',
      driverName: 'Conductor de Integración',
    });
  });

  it('repetir el registro del mismo tripId devuelve el mismo comprobante y no crea duplicados', async () => {
    const first = await authed().post(RECEIPTS).send(validBody('trip-it-repeat')).expect(201);
    const second = await authed().post(RECEIPTS).send(validBody('trip-it-repeat')).expect(201);

    expect(second.body.id).toBe(first.body.id);
    expect(second.body.receiptCode).toBe(first.body.receiptCode);
    expect(second.body.issuedAt).toBe(first.body.issuedAt);
    expect(await ctx.prisma.documentReceipt.count({ where: { tripId: 'trip-it-repeat' } })).toBe(1);
  });

  it('solicitudes simultáneas del mismo tripId no duplican (advisory lock de PostgreSQL)', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        authed().post(RECEIPTS).send(validBody('trip-it-concurrent')),
      ),
    );

    for (const res of responses) {
      expect(res.status).toBe(201);
    }
    const ids = new Set(responses.map((res) => res.body.id));
    const codes = new Set(responses.map((res) => res.body.receiptCode));
    expect(ids.size).toBe(1);
    expect(codes.size).toBe(1);
    expect(await ctx.prisma.documentReceipt.count({ where: { tripId: 'trip-it-concurrent' } })).toBe(1);
  });

  it('viajes distintos generan comprobantes distintos con receiptCode único', async () => {
    const a = await authed().post(RECEIPTS).send(validBody('trip-it-A')).expect(201);
    const b = await authed().post(RECEIPTS).send(validBody('trip-it-B')).expect(201);

    expect(a.body.id).not.toBe(b.body.id);
    expect(a.body.receiptCode).not.toBe(b.body.receiptCode);
    expect(await ctx.prisma.documentReceipt.count()).toBe(2);
  });

  it('rechaza con 400 un cuerpo inválido y no persiste nada', async () => {
    await authed()
      .post(RECEIPTS)
      .send({ ...validBody('trip-it-invalid'), amount: -10, passengerEmail: 'no-es-un-email' })
      .expect(400);

    expect(await ctx.prisma.documentReceipt.count()).toBe(0);
  });

  it('descarga el PDF de un comprobante existente sin crear ni modificar registros', async () => {
    const created = await authed().post(RECEIPTS).send(validBody('trip-it-download')).expect(201);
    const before = await ctx.prisma.documentReceipt.findUniqueOrThrow({ where: { id: created.body.id } });

    const res = await authed()
      .get(`${RECEIPTS}/trip-it-download/download`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain(
      `comprobante-${created.body.receiptCode}.pdf`,
    );
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(500);

    // El GET no crea registros y conserva la fecha de emisión original.
    expect(await ctx.prisma.documentReceipt.count()).toBe(1);
    const after = await ctx.prisma.documentReceipt.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(after.createdAt.toISOString()).toBe(before.createdAt.toISOString());
    expect(after.receiptCode).toBe(before.receiptCode);
  });

  it('responde 404 al descargar un tripId inexistente y no crea registros', async () => {
    const res = await authed().get(`${RECEIPTS}/trip-it-inexistente/download`).expect(404);

    expect(res.body.message).toContain('trip-it-inexistente');
    expect(await ctx.prisma.documentReceipt.count()).toBe(0);
  });

  it('POST /api/v1/eventos (VIAJE_FINALIZADO) emite el comprobante en PostgreSQL, genera el PDF automáticamente y soporta descarga y reenvío canónicos', async () => {
    const tripId = '77777777-7777-4777-8777-777777777777';
    const passengerId = '88888888-8888-4888-8888-888888888888';

    await authed(serviceJwt)
      .post('/api/v1/eventos')
      .send({
        eventoId: '99999999-9999-4999-8999-999999999999',
        tipo: 'VIAJE_FINALIZADO',
        origen: 'M6',
        ocurridoEn: '2026-11-27T12:00:00.000Z',
        viajeId: tripId,
        destinatarios: [
          {
            usuarioId: passengerId,
            rol: 'CLIENTE',
            email: 'pasajero.canonico@ejemplo.com',
            canalesPreferidos: ['EMAIL'],
          },
        ],
        detalle: {
          origen: 'Plaza 25 de Mayo',
          destino: 'UTN FRRe',
          importe: { monto: 4600, moneda: 'ARS' },
        },
      })
      .expect(202);

    const row = await ctx.prisma.documentReceipt.findFirstOrThrow({ where: { tripId } });
    expect(ctx.mailer.sent).toHaveLength(1);
    expect(ctx.mailer.sent[0].attachments?.[0]?.filename).toBe(`comprobante-${row.receiptCode}.pdf`);
    expect(ctx.mailer.sent[0].attachments?.[0]?.contentType).toBe('application/pdf');
    expect(Buffer.isBuffer(ctx.mailer.sent[0].attachments?.[0]?.content)).toBe(true);
    expect(
      (ctx.mailer.sent[0].attachments![0].content as Buffer).subarray(0, 5).toString('latin1'),
    ).toBe('%PDF-');

    // Descarga en el endpoint canónico GET /api/v1/comprobantes/{id}/pdf usando comprobanteId (UUID)
    const downloadRes = await authed()
      .get(`/api/v1/comprobantes/${row.id}/pdf`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    expect(downloadRes.headers['content-type']).toContain('application/pdf');
    const downloadedPdf = downloadRes.body as Buffer;
    expect(downloadedPdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(downloadedPdf.toString('latin1')).toContain('%%EOF');

    await authed()
      .get('/api/v1/comprobantes/00000000-0000-4000-8000-000000000000/pdf')
      .expect(404);

    // Reenvío en el endpoint canónico POST /api/v1/comprobantes/{id}/reenvios
    ctx.mailer.sent.length = 0;
    const resendRes = await authed()
      .post(`/api/v1/comprobantes/${row.id}/reenvios`)
      .set('Idempotency-Key', 'idem-it-reenvio-001')
      .send({ canal: 'EMAIL' })
      .expect(202);

    expect(resendRes.body).toMatchObject({
      canal: 'EMAIL',
      estado: 'ENVIADA',
      comprobanteId: row.id,
      codigoComprobante: row.receiptCode,
    });
    expect(ctx.mailer.sent).toHaveLength(1);
    expect(ctx.mailer.sent[0].recipient).toBe('pasajero.canonico@ejemplo.com');
    const resentAttachment = ctx.mailer.sent[0].attachments?.[0];
    expect(resentAttachment?.filename).toBe(`comprobante-${row.receiptCode}.pdf`);
    expect(resentAttachment?.contentType).toBe('application/pdf');
    expect(Buffer.isBuffer(resentAttachment?.content)).toBe(true);
    expect((resentAttachment!.content as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // No crea un segundo comprobante ni altera la fecha de emisión original
    expect(await ctx.prisma.documentReceipt.count()).toBe(1);
    const afterResend = await ctx.prisma.documentReceipt.findUniqueOrThrow({ where: { id: row.id } });
    expect(afterResend.createdAt.toISOString()).toBe(row.createdAt.toISOString());
  });
});
