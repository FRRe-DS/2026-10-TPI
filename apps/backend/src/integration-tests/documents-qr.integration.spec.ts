import { createIntegrationApp, IntegrationApp } from './support/integration-app';

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `Bearer eyJhbGciOiJIUzI1NiJ9.${encoded}.sig`;
}

/**
 * Pruebas de INTEGRACIÓN del flujo de verificación QR (RF-8.3 / RF-6.4 / RNF-08):
 * HTTP real + controlador + casos de uso + Prisma + PostgreSQL temporal (Testcontainers).
 *
 * Verifica persistencia real, reemplazo de QR previo, idempotencia HTTP,
 * expiración, rechazo por viaje distinto y consumo atómico bajo concurrencia real.
 */
describe('Códigos QR de viaje — API + Prisma + PostgreSQL temporal', () => {
  let ctx: IntegrationApp;

  const serviceJwt = makeJwt({ sub: 'm6-viajes', rol: 'SERVICIO' });
  const clientJwt = (sub: string) => makeJwt({ sub, rol: 'CLIENTE' });

  beforeAll(async () => {
    ctx = await createIntegrationApp();
  }, 120_000);

  beforeEach(async () => {
    await ctx.database.reset();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('POST /api/v1/viajes/:viajeId/qr genera el token en PostgreSQL y POST /api/v1/qr/validaciones lo consume devolviendo { qrId, viajeId, usadoEn }', async () => {
    const viajeId = 'trip-qr-ok-01';
    const genRes = await ctx
      .http()
      .post(`/api/v1/viajes/${viajeId}/qr`)
      .set('Authorization', clientJwt('usr-qr-01'))
      .set('Idempotency-Key', 'idem-qr-gen-01')
      .send({ clienteId: 'usr-qr-01', validezSegundos: 300 })
      .expect(201);

    expect(genRes.body).toMatchObject({
      qrId: expect.any(String),
      viajeId,
      estado: 'VIGENTE',
      token: expect.stringMatching(/^qr_trip-qr-ok-01_/),
    });

    const persisted = await ctx.prisma.qrVerificationToken.findUniqueOrThrow({
      where: { token: genRes.body.token },
    });
    expect(persisted.isUsed).toBe(false);
    expect(persisted.tripId).toBe(viajeId);

    const valRes = await ctx
      .http()
      .post('/api/v1/qr/validaciones')
      .set('Authorization', serviceJwt)
      .set('Idempotency-Key', 'idem-qr-val-01')
      .send({ token: genRes.body.token, viajeId })
      .expect(200);

    expect(valRes.body).toMatchObject({
      qrId: expect.any(String),
      viajeId,
      usadoEn: expect.any(String),
      valido: true,
    });

    const afterConsume = await ctx.prisma.qrVerificationToken.findUniqueOrThrow({
      where: { token: genRes.body.token },
    });
    expect(afterConsume.isUsed).toBe(true);
    expect(afterConsume.usedAt).not.toBeNull();

    // Repetir con misma Idempotency-Key y mismo payload devuelve 200 cacheado
    const cachedRes = await ctx
      .http()
      .post('/api/v1/qr/validaciones')
      .set('Authorization', serviceJwt)
      .set('Idempotency-Key', 'idem-qr-val-01')
      .send({ token: genRes.body.token, viajeId })
      .expect(200);
    expect(cachedRes.body.usadoEn).toBe(valRes.body.usadoEn);

    // Reutilizar misma Idempotency-Key con otro viajeId devuelve 422
    await ctx
      .http()
      .post('/api/v1/qr/validaciones')
      .set('Authorization', serviceJwt)
      .set('Idempotency-Key', 'idem-qr-val-01')
      .send({ token: genRes.body.token, viajeId: 'otro-viaje' })
      .expect(422);
  });

  it('concurrencia real (RNF-08): 5 validaciones simultáneas del mismo QR permiten exactamente 1 éxito (200) y 4 conflictos (409)', async () => {
    const viajeId = 'trip-qr-conc-01';
    const genRes = await ctx
      .http()
      .post(`/api/v1/viajes/${viajeId}/qr`)
      .set('Authorization', serviceJwt)
      .send({ clienteId: 'usr-qr-conc', validezSegundos: 300 })
      .expect(201);

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, idx) =>
        ctx
          .http()
          .post('/api/v1/qr/validaciones')
          .set('Authorization', serviceJwt)
          .set('Idempotency-Key', `idem-conc-${idx}`)
          .send({ token: genRes.body.token, viajeId }),
      ),
    );

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
  });

  it('emitir un nuevo QR para el mismo viaje invalida el anterior (409) y valida errores 404 / 422', async () => {
    const viajeId = 'trip-qr-replace-01';
    const first = await ctx
      .http()
      .post(`/api/v1/viajes/${viajeId}/qr`)
      .set('Authorization', serviceJwt)
      .send({ clienteId: 'usr-qr-rep', validezSegundos: 300 })
      .expect(201);

    const second = await ctx
      .http()
      .post(`/api/v1/viajes/${viajeId}/qr`)
      .set('Authorization', serviceJwt)
      .send({ clienteId: 'usr-qr-rep', validezSegundos: 300 })
      .expect(201);

    // El QR reemplazado devuelve 409
    await ctx
      .http()
      .post('/api/v1/qr/validaciones')
      .set('Authorization', serviceJwt)
      .send({ token: first.body.token, viajeId })
      .expect(409);

    // Viaje distinto devuelve 422
    await ctx
      .http()
      .post('/api/v1/qr/validaciones')
      .set('Authorization', serviceJwt)
      .send({ token: second.body.token, viajeId: 'trip-qr-equivocado' })
      .expect(422);

    // Token inexistente devuelve 404
    await ctx
      .http()
      .post('/api/v1/qr/validaciones')
      .set('Authorization', serviceJwt)
      .send({ token: 'qr_inexistente_000', viajeId })
      .expect(404);

    // Token expirado en PostgreSQL devuelve 422
    await ctx.prisma.qrVerificationToken.create({
      data: {
        token: 'qr_expirado_test',
        tripId: 'trip-qr-exp-01',
        passengerId: 'usr-exp',
        expiresAt: new Date(Date.now() - 60_000),
        isUsed: false,
      },
    });
    await ctx
      .http()
      .post('/api/v1/qr/validaciones')
      .set('Authorization', serviceJwt)
      .send({ token: 'qr_expirado_test', viajeId: 'trip-qr-exp-01' })
      .expect(422);
  });
});
