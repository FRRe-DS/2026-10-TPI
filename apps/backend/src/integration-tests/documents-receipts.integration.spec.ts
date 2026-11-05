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
  }, 120_000);

  beforeEach(async () => {
    await ctx.database.reset();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('registra un comprobante: responde 201 y lo persiste realmente en PostgreSQL', async () => {
    const res = await ctx.http().post(RECEIPTS).send(validBody('trip-it-register')).expect(201);

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
    const first = await ctx.http().post(RECEIPTS).send(validBody('trip-it-repeat')).expect(201);
    const second = await ctx.http().post(RECEIPTS).send(validBody('trip-it-repeat')).expect(201);

    expect(second.body.id).toBe(first.body.id);
    expect(second.body.receiptCode).toBe(first.body.receiptCode);
    expect(second.body.issuedAt).toBe(first.body.issuedAt);
    expect(await ctx.prisma.documentReceipt.count({ where: { tripId: 'trip-it-repeat' } })).toBe(1);
  });

  it('solicitudes simultáneas del mismo tripId no duplican (advisory lock de PostgreSQL)', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        ctx.http().post(RECEIPTS).send(validBody('trip-it-concurrent')),
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
    const a = await ctx.http().post(RECEIPTS).send(validBody('trip-it-A')).expect(201);
    const b = await ctx.http().post(RECEIPTS).send(validBody('trip-it-B')).expect(201);

    expect(a.body.id).not.toBe(b.body.id);
    expect(a.body.receiptCode).not.toBe(b.body.receiptCode);
    expect(await ctx.prisma.documentReceipt.count()).toBe(2);
  });

  it('rechaza con 400 un cuerpo inválido y no persiste nada', async () => {
    await ctx
      .http()
      .post(RECEIPTS)
      .send({ ...validBody('trip-it-invalid'), amount: -10, passengerEmail: 'no-es-un-email' })
      .expect(400);

    expect(await ctx.prisma.documentReceipt.count()).toBe(0);
  });

  it('descarga el PDF de un comprobante existente sin crear ni modificar registros', async () => {
    const created = await ctx.http().post(RECEIPTS).send(validBody('trip-it-download')).expect(201);
    const before = await ctx.prisma.documentReceipt.findUniqueOrThrow({ where: { id: created.body.id } });

    const res = await ctx
      .http()
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
    const res = await ctx.http().get(`${RECEIPTS}/trip-it-inexistente/download`).expect(404);

    expect(res.body.message).toContain('trip-it-inexistente');
    expect(await ctx.prisma.documentReceipt.count()).toBe(0);
  });
});
