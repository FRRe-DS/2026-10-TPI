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
  let operatorJwt: string;

  const authed = () => {
    const agent = ctx.http();
    return {
      get: (url: string) => agent.get(url).set('Authorization', operatorJwt),
      post: (url: string) => agent.post(url).set('Authorization', operatorJwt),
      patch: (url: string) => agent.patch(url).set('Authorization', operatorJwt),
    };
  };

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
    operatorJwt = ctx.issueBearerToken({ sub: 'operador-it-1', role: 'OPERADOR' });
  }, 120_000);

  beforeEach(async () => {
    await ctx.database.reset();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('CREATE: crea un ticket (201) en estado OPEN y lo persiste en PostgreSQL', async () => {
    const res = await authed().post(TICKETS).send(validTicket()).expect(201);

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
    await authed()
      .post(TICKETS)
      .send({ ...validTicket(), subject: 'x', description: 'corta', referenceType: 'INVALIDO' })
      .expect(400);

    expect(await ctx.prisma.supportTicket.count()).toBe(0);
  });

  it('READ: obtiene por UUID y por ticketNumber, lista con filtros y responde 404 si no existe', async () => {
    const a = await authed().post(TICKETS).send(validTicket('trip-it-A')).expect(201);
    await authed().post(TICKETS).send(validTicket('trip-it-B')).expect(201);

    const byId = await authed().get(`${TICKETS}/${a.body.id}`).expect(200);
    expect(byId.body.ticketNumber).toBe(a.body.ticketNumber);

    const byNumber = await authed().get(`${TICKETS}/${a.body.ticketNumber}`).expect(200);
    expect(byNumber.body.id).toBe(a.body.id);

    const all = await authed().get(TICKETS).expect(200);
    expect(all.body).toHaveLength(2);

    const filtered = await authed().get(`${TICKETS}?referenceId=trip-it-A`).expect(200);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].id).toBe(a.body.id);

    await authed().get(`${TICKETS}/00000000-0000-0000-0000-000000000000`).expect(404);
  });

  it('UPDATE: recorre OPEN → IN_PROGRESS → RESOLVED → CLOSED y persiste cada estado', async () => {
    const created = await authed().post(TICKETS).send(validTicket()).expect(201);
    const url = `${TICKETS}/${created.body.id}/status`;

    await authed().patch(url).send({ status: 'IN_PROGRESS' }).expect(200);
    expect((await ctx.prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe(
      'IN_PROGRESS',
    );

    await authed()
      .patch(url)
      .send({ status: 'RESOLVED', resolutionNote: 'Reintegro emitido.' })
      .expect(200);
    const resolved = await ctx.prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolutionNote).toBe('Reintegro emitido.');

    await authed().patch(url).send({ status: 'CLOSED' }).expect(200);
    expect((await ctx.prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe(
      'CLOSED',
    );
  });

  it('UPDATE: rechaza con 400 una transición inválida y un ticket CLOSED; 404 si no existe', async () => {
    const created = await authed().post(TICKETS).send(validTicket()).expect(201);
    const url = `${TICKETS}/${created.body.id}/status`;

    // OPEN → RESOLVED no está permitido (debe pasar por IN_PROGRESS).
    await authed().patch(url).send({ status: 'RESOLVED' }).expect(400);
    expect((await ctx.prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe(
      'OPEN',
    );

    await authed().patch(url).send({ status: 'IN_PROGRESS' }).expect(200);
    await authed().patch(url).send({ status: 'RESOLVED' }).expect(200);
    await authed().patch(url).send({ status: 'CLOSED' }).expect(200);
    await authed().patch(url).send({ status: 'OPEN' }).expect(400); // CLOSED es final

    await authed()
      .patch(`${TICKETS}/00000000-0000-0000-0000-000000000000/status`)
      .send({ status: 'IN_PROGRESS' })
      .expect(404);
  });

  it('CANÓNICO (/api/v1/tickets): crea, resuelve, reabre (RESUELTO -> EN_REVISION) y persiste historial paginado en PostgreSQL', async () => {
    const clienteJwt = ctx.issueBearerToken({ sub: 'usr-canon-1', role: 'CLIENTE' });
    const operadorJwt = ctx.issueBearerToken({ sub: 'operador-canon-1', role: 'OPERADOR' });

    const created = await ctx
      .http()
      .post('/api/v1/tickets')
      .set('Authorization', clienteJwt)
      .set('Idempotency-Key', 'idem-it-ticket-01')
      .send({
        referencia: { tipo: 'VIAJE', id: 'trip-canon-reopen-01' },
        titulo: 'Objeto olvidado en el vehículo',
        descripcion: 'Dejé una mochila en el asiento trasero al bajar.',
      })
      .expect(201);

    const ticketId = created.body.ticketId;
    expect(created.body.estado).toBe('ABIERTO');

    await ctx
      .http()
      .patch(`/api/v1/tickets/${ticketId}`)
      .set('Authorization', operadorJwt)
      .send({ estado: 'EN_REVISION', motivo: 'Contactando al conductor' })
      .expect(200);

    await ctx
      .http()
      .patch(`/api/v1/tickets/${ticketId}`)
      .set('Authorization', operadorJwt)
      .send({ estado: 'RESUELTO', resolucion: 'Conductor confirmó entrega en base' })
      .expect(200);

    // Reapertura RESUELTO -> EN_REVISION (RF-8.7 / PR #12)
    const reopened = await ctx
      .http()
      .patch(`/api/v1/tickets/${ticketId}`)
      .set('Authorization', operadorJwt)
      .send({ estado: 'EN_REVISION', motivo: 'Pasajero indica que aún no retiró el objeto' })
      .expect(200);

    expect(reopened.body.estado).toBe('EN_REVISION');

    const historialPage0 = await ctx
      .http()
      .get(`/api/v1/tickets/${ticketId}/historial?page=0&size=2`)
      .set('Authorization', clienteJwt)
      .expect(200);

    expect(historialPage0.body).toMatchObject({
      page: 0,
      size: 2,
      totalElementos: 3,
      totalPaginas: 2,
    });
    expect(historialPage0.body.items).toHaveLength(2);

    const historialPage1 = await ctx
      .http()
      .get(`/api/v1/tickets/${ticketId}/historial?page=1&size=2`)
      .set('Authorization', clienteJwt)
      .expect(200);

    expect(historialPage1.body.items).toHaveLength(1);
    expect(historialPage1.body.items[0]).toMatchObject({
      estadoAnterior: 'RESUELTO',
      estadoNuevo: 'EN_REVISION',
      actorId: 'operador-canon-1',
      motivo: 'Pasajero indica que aún no retiró el objeto',
    });

    const msgRows = await ctx.prisma.ticketMessage.findMany({
      where: { ticketId, senderRole: 'HISTORIAL_ESTADO' },
    });
    expect(msgRows).toHaveLength(3);
  });
});
