import { createIntegrationApp, IntegrationApp } from './support/integration-app';

/**
 * Pruebas de INTEGRACIÓN del flujo de tickets de soporte (RF-8.7): HTTP + Prisma +
 * PostgreSQL temporal (Testcontainers). Requieren Docker: `npm run test:integration`.
 *
 * Cobertura CRUD sobre endpoints EXISTENTES:
 *   Create (POST) · Read (GET lista / GET detalle) · Update (PATCH estado).
 * No existe un endpoint DELETE en producción (y no se agregó solo para esta demo):
 * el borrado de datos entre pruebas lo hace el arnés con TRUNCATE protegido por el guardián.
 */
describe('Tickets de soporte — API + Prisma + PostgreSQL temporal (CRUD sobre endpoints existentes)', () => {
  let ctx: IntegrationApp;

  const TICKETS = '/api/v1/support/tickets';
  const validTicket = (referenceId = 'trip-it-ticket') => ({
    referenceId,
    referenceType: 'TRIP',
    subject: 'Tarifa debitada incorrecta',
    description: 'Se cobró un recargo que no figuraba en la cotización del viaje.',
    createdBy: 'usr-it-001',
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

  it('CREATE: crea un ticket (201) en estado OPEN y lo persiste en PostgreSQL', async () => {
    const res = await ctx.http().post(TICKETS).send(validTicket()).expect(201);

    expect(res.body).toMatchObject({
      id: expect.any(String),
      ticketNumber: expect.stringMatching(/^TCK-2026-[0-9A-F]{6}$/),
      referenceId: 'trip-it-ticket',
      referenceType: 'TRIP',
      status: 'OPEN',
      createdBy: 'usr-it-001',
    });

    const row = await ctx.prisma.supportTicket.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.ticketNumber).toBe(res.body.ticketNumber);
    expect(row.status).toBe('OPEN');
  });

  it('CREATE: rechaza con 400 un ticket inválido y no persiste nada', async () => {
    await ctx
      .http()
      .post(TICKETS)
      .send({ ...validTicket(), subject: 'x', description: 'corta', referenceType: 'INVALIDO' })
      .expect(400);

    expect(await ctx.prisma.supportTicket.count()).toBe(0);
  });

  it('READ: obtiene por UUID y por ticketNumber, lista con filtros y responde 404 si no existe', async () => {
    const a = await ctx.http().post(TICKETS).send(validTicket('trip-it-A')).expect(201);
    await ctx.http().post(TICKETS).send(validTicket('trip-it-B')).expect(201);

    const byId = await ctx.http().get(`${TICKETS}/${a.body.id}`).expect(200);
    expect(byId.body.ticketNumber).toBe(a.body.ticketNumber);

    const byNumber = await ctx.http().get(`${TICKETS}/${a.body.ticketNumber}`).expect(200);
    expect(byNumber.body.id).toBe(a.body.id);

    const all = await ctx.http().get(TICKETS).expect(200);
    expect(all.body).toHaveLength(2);

    const filtered = await ctx.http().get(`${TICKETS}?referenceId=trip-it-A`).expect(200);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].id).toBe(a.body.id);

    await ctx.http().get(`${TICKETS}/00000000-0000-0000-0000-000000000000`).expect(404);
  });

  it('UPDATE: recorre OPEN → IN_PROGRESS → RESOLVED → CLOSED y persiste cada estado', async () => {
    const created = await ctx.http().post(TICKETS).send(validTicket()).expect(201);
    const url = `${TICKETS}/${created.body.id}/status`;

    await ctx.http().patch(url).send({ status: 'IN_PROGRESS' }).expect(200);
    expect((await ctx.prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe(
      'IN_PROGRESS',
    );

    await ctx
      .http()
      .patch(url)
      .send({ status: 'RESOLVED', resolutionNote: 'Reintegro emitido.' })
      .expect(200);
    const resolved = await ctx.prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolutionNote).toBe('Reintegro emitido.');

    await ctx.http().patch(url).send({ status: 'CLOSED' }).expect(200);
    expect((await ctx.prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe(
      'CLOSED',
    );
  });

  it('UPDATE: rechaza con 400 una transición inválida y un ticket CLOSED; 404 si no existe', async () => {
    const created = await ctx.http().post(TICKETS).send(validTicket()).expect(201);
    const url = `${TICKETS}/${created.body.id}/status`;

    // OPEN → RESOLVED no está permitido (debe pasar por IN_PROGRESS).
    await ctx.http().patch(url).send({ status: 'RESOLVED' }).expect(400);
    expect((await ctx.prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe(
      'OPEN',
    );

    await ctx.http().patch(url).send({ status: 'IN_PROGRESS' }).expect(200);
    await ctx.http().patch(url).send({ status: 'RESOLVED' }).expect(200);
    await ctx.http().patch(url).send({ status: 'CLOSED' }).expect(200);
    await ctx.http().patch(url).send({ status: 'OPEN' }).expect(400); // CLOSED es final

    await ctx
      .http()
      .patch(`${TICKETS}/00000000-0000-0000-0000-000000000000/status`)
      .send({ status: 'IN_PROGRESS' })
      .expect(404);
  });
});
