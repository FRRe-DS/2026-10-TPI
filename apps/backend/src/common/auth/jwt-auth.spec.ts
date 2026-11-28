import { INestApplication, Logger, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';
import * as http from 'http';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { ProblemDetailsFilter } from '../problem-details.filter';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';
import { DocumentsController } from '../../modules/documents/infrastructure/controllers/documents.controller';
import { DocumentsService } from '../../modules/documents/application/documents.service';
import { GenerateReceiptPdfUseCase } from '../../modules/documents/application/use-cases/generate-receipt-pdf.use-case';
import { RegisterReceiptUseCase } from '../../modules/documents/application/use-cases/register-receipt.use-case';
import { EventsController } from '../../modules/simulator/events.controller';
import { NotificationsService } from '../../modules/notifications/application/notifications.service';
import { IssueReceiptUseCase } from '../../modules/documents/application/use-cases/issue-receipt.use-case';
import { NotificationsController } from '../../modules/notifications/infrastructure/controllers/notifications.controller';
import { SupportController } from '../../modules/support/infrastructure/controllers/support.controller';
import { SupportService } from '../../modules/support/application/support.service';
import { HealthController } from '../../modules/health/health.controller';
import {
  DevAuthController,
  DevTokenProviderService,
  extractRolesFromVerifiedPayload,
  JwtAuthGuard,
  JwtAuthService,
  RolesGuard,
} from './index';

interface TestRsaKeyPair {
  kid: string;
  privateKeyPem: string;
  publicJwk: Record<string, unknown>;
}

function generateTestRsaKeyPair(kid: string): TestRsaKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return {
    kid,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicJwk: {
      ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
      kid,
      use: 'sig',
      alg: 'RS256',
    },
  };
}

function startJwksServer(keys: Record<string, unknown>[]): Promise<{
  server: http.Server;
  jwksUri: string;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/certs') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ keys }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, jwksUri: `http://127.0.0.1:${port}/certs` });
    });
  });
}

describe('Autenticación JWT criptográfica con JWKS y RBAC (Keycloak + Contrato M8)', () => {
  const TEST_ISSUER = 'https://auth.test.local/realms/consorcio-2-test';
  const TEST_AUDIENCE = 'm8-notificaciones-test';
  const CONFIGURED_CLIENTS = ['m8-notificaciones', 'grupo-12', 'grupo-9'];

  let trustedKey: TestRsaKeyPair;
  let rogueKey: TestRsaKeyPair;
  let jwksServer: http.Server;
  let rogueJwksServer: http.Server;
  let jwksUri: string;
  let rogueJwksUri: string;
  let jwtAuthService: JwtAuthService;
  let app: INestApplication;

  const signToken = (
    payload: Record<string, unknown>,
    options: {
      key?: TestRsaKeyPair;
      issuer?: string;
      audience?: string;
      expiresIn?: number | string;
      noExp?: boolean;
      extraHeader?: Record<string, unknown>;
    } = {},
  ): string => {
    const key = options.key ?? trustedKey;
    const signOpts: jwt.SignOptions = {
      algorithm: 'RS256',
      keyid: key.kid,
      issuer: options.issuer ?? TEST_ISSUER,
      audience: options.audience ?? TEST_AUDIENCE,
      header: {
        alg: 'RS256',
        typ: 'JWT',
        kid: key.kid,
        ...(options.extraHeader ?? {}),
      },
    };
    if (!options.noExp) {
      signOpts.expiresIn = (options.expiresIn ?? 300) as jwt.SignOptions['expiresIn'];
    }
    return jwt.sign(payload, key.privateKeyPem, signOpts);
  };

  beforeAll(async () => {
    trustedKey = generateTestRsaKeyPair('test-key-rsa-1');
    rogueKey = generateTestRsaKeyPair('rogue-key-rsa-99');

    const trusted = await startJwksServer([trustedKey.publicJwk]);
    jwksServer = trusted.server;
    jwksUri = trusted.jwksUri;

    const rogue = await startJwksServer([rogueKey.publicJwk]);
    rogueJwksServer = rogue.server;
    rogueJwksUri = rogue.jwksUri;

    jwtAuthService = new JwtAuthService(undefined, {
      jwksUri,
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      algorithms: ['RS256'],
      keycloakClientIds: CONFIGURED_CLIENTS,
      clockToleranceSeconds: 2,
    });

    const documentsServiceMock = {
      generateQr: jest.fn(),
      verifyQr: jest.fn().mockResolvedValue({
        valid: true,
        tripId: '550e8400-e29b-41d4-a716-446655440010',
        token: 'qr-opaque-token',
        verifiedAt: '2026-11-28T15:00:00.000Z',
        message: 'Código QR verificado exitosamente.',
      }),
      findAllReceipts: jest.fn().mockResolvedValue([]),
      findReceiptByIdOrTripId: jest.fn().mockResolvedValue(null),
      findReceiptByTripId: jest.fn().mockResolvedValue(null),
      resendReceipt: jest.fn(),
    };

    const notificationsServiceMock = {
      send: jest.fn().mockResolvedValue({ success: true, id: 'notif-1', status: 'SENT' }),
      getLogs: jest.fn().mockResolvedValue([]),
      enviarUnificada: jest.fn().mockResolvedValue({ notificacionId: 'notif-1', estado: 'ENVIADA' }),
      listarPaginadas: jest.fn().mockResolvedValue({
        page: 0,
        size: 20,
        totalElementos: 0,
        totalPaginas: 1,
        items: [],
      }),
      findById: jest.fn(),
      getIntentos: jest.fn(),
      retry: jest.fn(),
    };

    const supportServiceMock = {
      create: jest.fn(),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({
        id: 'tck-1',
        ticketNumber: 'TCK-2026-000001',
        referenceId: 'trip-1',
        referenceType: 'TRIP',
        subject: 'Consulta',
        description: 'Detalle de consulta',
        status: 'OPEN',
        priority: 'MEDIUM',
        createdBy: 'usr-cliente-1',
        createdAt: new Date('2026-11-28T10:00:00Z'),
        updatedAt: new Date('2026-11-28T10:00:00Z'),
      }),
      updateStatus: jest.fn().mockResolvedValue({
        id: 'tck-1',
        ticketNumber: 'TCK-2026-000001',
        referenceId: 'trip-1',
        referenceType: 'TRIP',
        subject: 'Consulta',
        description: 'Detalle de consulta',
        status: 'IN_PROGRESS',
        priority: 'MEDIUM',
        createdBy: 'usr-cliente-1',
        createdAt: new Date('2026-11-28T10:00:00Z'),
        updatedAt: new Date('2026-11-28T10:05:00Z'),
      }),
      appendHistory: jest.fn().mockResolvedValue(undefined),
      getHistory: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [
        HealthController,
        EventsController,
        DocumentsController,
        NotificationsController,
        SupportController,
        DevAuthController,
      ],
      providers: [
        { provide: JwtAuthService, useValue: jwtAuthService },
        DevTokenProviderService,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: DocumentsService, useValue: documentsServiceMock },
        { provide: GenerateReceiptPdfUseCase, useValue: { execute: jest.fn() } },
        { provide: RegisterReceiptUseCase, useValue: { execute: jest.fn() } },
        { provide: IssueReceiptUseCase, useValue: { execute: jest.fn() } },
        { provide: NotificationsService, useValue: notificationsServiceMock },
        { provide: SupportService, useValue: supportServiceMock },
        {
          provide: PrismaService,
          useValue: { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) },
        },
        {
          provide: RedisService,
          useValue: { ping: jest.fn().mockResolvedValue(true), get: jest.fn().mockResolvedValue(null), set: jest.fn() },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve) => jwksServer?.close(() => resolve()));
    await new Promise<void>((resolve) => rogueJwksServer?.close(() => resolve()));
  });

  describe('Validación criptográfica de JWT en JwtAuthService', () => {
    it('acepta un JWT válido firmado con RS256 contra JWKS y extrae identidad y roles', async () => {
      const token = signToken({
        sub: 'grupo-12',
        azp: 'grupo-12',
        realm_access: { roles: ['SERVICIO'] },
      });

      const identity = await jwtAuthService.verifyAuthorizationHeader(`Bearer ${token}`);
      expect(identity).toMatchObject({
        authenticated: true,
        sub: 'grupo-12',
        azp: 'grupo-12',
        rol: 'SERVICIO',
        roles: ['SERVICIO'],
        iss: TEST_ISSUER,
        aud: TEST_AUDIENCE,
      });
    });

    it('rechaza con 401 un JWT cuya firma fue manipulada o firmado con otra clave RSA', async () => {
      const validToken = signToken({ sub: 'grupo-12', role: 'SERVICIO' });
      const parts = validToken.split('.');
      const tamperedPayload = Buffer.from(
        JSON.stringify({ sub: 'attacker', role: 'OPERADOR', exp: Math.floor(Date.now() / 1000) + 300 }),
      ).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      await expect(jwtAuthService.verifyToken(tamperedToken)).rejects.toThrow(UnauthorizedException);

      const rogueSigned = signToken(
        { sub: 'grupo-12', role: 'SERVICIO' },
        { key: rogueKey },
      );
      await expect(jwtAuthService.verifyToken(rogueSigned)).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza con 401 tokens sin firma (alg: none) y ataques de confusión de algoritmo (HS256)', async () => {
      const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'grupo-12',
          role: 'SERVICIO',
          iss: TEST_ISSUER,
          aud: TEST_AUDIENCE,
          exp: Math.floor(Date.now() / 1000) + 300,
        }),
      ).toString('base64url');

      await expect(jwtAuthService.verifyToken(`${noneHeader}.${payload}.`)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(jwtAuthService.verifyToken(`${noneHeader}.${payload}.fakesig`)).rejects.toThrow(
        UnauthorizedException,
      );

      const hs256Token = jwt.sign(
        { sub: 'grupo-12', role: 'SERVICIO' },
        'symmetric-secret',
        { algorithm: 'HS256', issuer: TEST_ISSUER, audience: TEST_AUDIENCE, expiresIn: 300 },
      );
      await expect(jwtAuthService.verifyToken(hs256Token)).rejects.toThrow(UnauthorizedException);
    });

    it('ignora URLs jku/x5u arbitrarias dentro del token (solo confía en el JWKS configurado)', async () => {
      const jkuInjectedToken = signToken(
        { sub: 'grupo-12', role: 'SERVICIO' },
        {
          key: rogueKey,
          extraHeader: { jku: rogueJwksUri, x5u: rogueJwksUri },
        },
      );

      await expect(jwtAuthService.verifyToken(jkuInjectedToken)).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza con 401 un JWT expirado, sin exp o con nbf en el futuro', async () => {
      const expiredToken = signToken(
        { sub: 'grupo-12', role: 'SERVICIO' },
        { expiresIn: -60 },
      );
      await expect(jwtAuthService.verifyToken(expiredToken)).rejects.toThrow(UnauthorizedException);

      const noExpToken = signToken(
        { sub: 'grupo-12', role: 'SERVICIO' },
        { noExp: true },
      );
      await expect(jwtAuthService.verifyToken(noExpToken)).rejects.toThrow(UnauthorizedException);

      const futureNbfToken = signToken({
        sub: 'grupo-12',
        role: 'SERVICIO',
        nbf: Math.floor(Date.now() / 1000) + 600,
      });
      await expect(jwtAuthService.verifyToken(futureNbfToken)).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza con 401 issuer (iss) o audience (aud) incorrectos', async () => {
      const wrongIssuer = signToken(
        { sub: 'grupo-12', role: 'SERVICIO' },
        { issuer: 'https://otro-realm.example.com/realms/fake' },
      );
      await expect(jwtAuthService.verifyToken(wrongIssuer)).rejects.toThrow(UnauthorizedException);

      const wrongAudience = signToken(
        { sub: 'grupo-12', role: 'SERVICIO' },
        { audience: 'otro-servicio' },
      );
      await expect(jwtAuthService.verifyToken(wrongAudience)).rejects.toThrow(UnauthorizedException);
    });

    it('no registra el token JWT completo en los logs cuando ocurre un rechazo', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const expiredToken = signToken({ sub: 'grupo-12', role: 'SERVICIO' }, { expiresIn: -30 });

      try {
        await expect(jwtAuthService.verifyToken(expiredToken)).rejects.toThrow(UnauthorizedException);
        const allLogs = [...warnSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ');
        expect(allLogs).not.toContain(expiredToken);
        expect(allLogs).not.toContain(expiredToken.split('.')[2]);
      } finally {
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });
  });

  describe('Extracción de roles planos y anidados de Keycloak', () => {
    it('reconoce role, rol, roles, realm_access.roles y resource_access[clientId].roles', () => {
      expect(extractRolesFromVerifiedPayload({ role: 'servicio' }, CONFIGURED_CLIENTS)).toEqual(['SERVICIO']);
      expect(extractRolesFromVerifiedPayload({ rol: 'operador' }, CONFIGURED_CLIENTS)).toEqual(['OPERADOR']);
      expect(extractRolesFromVerifiedPayload({ roles: ['cliente', 'conductor'] }, CONFIGURED_CLIENTS)).toEqual([
        'CLIENTE',
        'CONDUCTOR',
      ]);
      expect(
        extractRolesFromVerifiedPayload({ realm_access: { roles: ['servicio', 'default-roles'] } }, CONFIGURED_CLIENTS),
      ).toEqual(['SERVICIO', 'DEFAULT-ROLES']);
      expect(
        extractRolesFromVerifiedPayload(
          {
            resource_access: {
              'grupo-12': { roles: ['SERVICIO'] },
              'cliente-externo-no-configurado': { roles: ['OPERADOR'] },
            },
          },
          CONFIGURED_CLIENTS,
        ),
      ).toEqual(['SERVICIO']);
    });
  });

  describe('Protección HTTP de endpoints con JwtAuthGuard + RolesGuard + RFC 9457', () => {
    const validQrBody = {
      token: 'qr-opaque-token',
      viajeId: '550e8400-e29b-41d4-a716-446655440010',
    };
    const validEventoBody = {
      eventoId: '550e8400-e29b-41d4-a716-446655440077',
      tipo: 'RESERVA_CONFIRMADA',
      origen: 'M9',
      ocurridoEn: '2026-11-28T15:00:00.000Z',
      reservaId: '550e8400-e29b-41d4-a716-446655440088',
      destinatarios: [
        {
          usuarioId: 'usr-1',
          rol: 'CLIENTE',
          email: 'pasajero@ejemplo.com',
          canalesPreferidos: ['EMAIL'],
        },
      ],
    };

    it('permite GET /api/v1/health sin token (público según contrato)', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
      expect(res.body.estado).toBe('ok');
    });

    it('rechaza con HTTP 401 (RFC 9457) solicitudes sin Authorization en endpoints protegidos', async () => {
      const qrRes = await request(app.getHttpServer())
        .post('/api/v1/qr/validaciones')
        .send(validQrBody)
        .expect(401);
      expect(qrRes.headers['content-type']).toContain('application/problem+json');
      expect(qrRes.body).toMatchObject({ status: 401, type: 'about:blank' });

      await request(app.getHttpServer())
        .post('/api/v1/eventos')
        .send(validEventoBody)
        .expect(401);

      await request(app.getHttpServer()).get('/api/v1/notificaciones').expect(401);
      await request(app.getHttpServer()).get('/api/v1/comprobantes').expect(401);
      await request(app.getHttpServer()).get('/api/v1/tickets').expect(401);
    });

    it('rechaza con HTTP 403 un token válido sin ningún rol o con rol incorrecto', async () => {
      const noRoleToken = signToken({ sub: 'grupo-12' });
      const resNoRole = await request(app.getHttpServer())
        .post('/api/v1/qr/validaciones')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .send(validQrBody)
        .expect(403);
      expect(resNoRole.headers['content-type']).toContain('application/problem+json');

      const clienteToken = signToken({ sub: 'usr-cliente-1', realm_access: { roles: ['CLIENTE'] } });
      await request(app.getHttpServer())
        .post('/api/v1/qr/validaciones')
        .set('Authorization', `Bearer ${clienteToken}`)
        .send(validQrBody)
        .expect(403);

      const operadorToken = signToken({ sub: 'op-1', realm_access: { roles: ['OPERADOR'] } });
      await request(app.getHttpServer())
        .post('/api/v1/eventos')
        .set('Authorization', `Bearer ${operadorToken}`)
        .send(validEventoBody)
        .expect(403);

      const untrustedClientRoleToken = signToken({
        sub: 'grupo-99',
        resource_access: { 'grupo-99-no-autorizado': { roles: ['SERVICIO'] } },
      });
      await request(app.getHttpServer())
        .post('/api/v1/qr/validaciones')
        .set('Authorization', `Bearer ${untrustedClientRoleToken}`)
        .send(validQrBody)
        .expect(403);
    });

    it('acepta tokens client_credentials de grupo-12 (M6) y grupo-9 (M9) con rol SERVICIO en Keycloak', async () => {
      const grupo12Token = signToken({
        sub: 'service-account-grupo-12',
        azp: 'grupo-12',
        resource_access: { 'grupo-12': { roles: ['SERVICIO'] } },
      });

      const qrRes = await request(app.getHttpServer())
        .post('/api/v1/qr/validaciones')
        .set('Authorization', `Bearer ${grupo12Token}`)
        .send(validQrBody)
        .expect(200);
      expect(qrRes.body).toMatchObject({
        viajeId: validQrBody.viajeId,
        valido: true,
      });

      const grupo9Token = signToken({
        sub: 'service-account-grupo-9',
        azp: 'grupo-9',
        resource_access: { 'grupo-9': { roles: ['SERVICIO'] } },
      });

      const eventRes = await request(app.getHttpServer())
        .post('/api/v1/eventos')
        .set('Authorization', `Bearer ${grupo9Token}`)
        .send(validEventoBody)
        .expect(202);
      expect(eventRes.body).toMatchObject({
        eventoId: validEventoBody.eventoId,
        recibidoEn: expect.any(String),
      });
    });

    it('respeta los roles específicos de cada endpoint (no convierte todo en SERVICIO)', async () => {
      const serviceToken = signToken({ sub: 'grupo-12', realm_access: { roles: ['SERVICIO'] } });
      const operatorToken = signToken({ sub: 'op-1', realm_access: { roles: ['OPERADOR'] } });
      const clientToken = signToken({ sub: 'usr-cliente-1', realm_access: { roles: ['CLIENTE'] } });

      // GET /api/v1/comprobantes admite CLIENTE y OPERADOR, NO SERVICIO
      await request(app.getHttpServer())
        .get('/api/v1/comprobantes')
        .set('Authorization', `Bearer ${serviceToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/comprobantes')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/v1/comprobantes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      // PATCH /api/v1/tickets/:id admite solo OPERADOR
      await request(app.getHttpServer())
        .patch('/api/v1/tickets/tck-1')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ estado: 'EN_REVISION' })
        .expect(403);
      await request(app.getHttpServer())
        .patch('/api/v1/tickets/tck-1')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ estado: 'EN_REVISION' })
        .expect(200);
    });
  });

  describe('DevTokenProviderService (bloqueo estricto en producción + RS256 real en desarrollo)', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('permanece estrictamente deshabilitado en NODE_ENV=production aunque el flag esté en true', () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_DEV_TOKEN_PROVIDER_ENABLED = 'true';

      const provider = new DevTokenProviderService();
      expect(provider.isEnabled()).toBe(false);
      expect(provider.getJwks()).toEqual({ keys: [] });
      expect(() => provider.issueToken({ role: 'SERVICIO' })).toThrow();
    });

    it('permanece deshabilitado en entornos compartidos (staging o cuando AUTH_JWKS_URI está configurado)', () => {
      // Caso 1: staging
      process.env.NODE_ENV = 'staging';
      process.env.AUTH_DEV_TOKEN_PROVIDER_ENABLED = 'true';
      delete process.env.AUTH_JWKS_URI;

      const stagingProvider = new DevTokenProviderService();
      expect(stagingProvider.isEnabled()).toBe(false);
      expect(() => stagingProvider.issueToken({ role: 'OPERADOR' })).toThrow();

      // Caso 2: AUTH_JWKS_URI configurado (Keycloak/IdP externo conectado)
      process.env.NODE_ENV = 'development';
      process.env.AUTH_JWKS_URI = 'https://keycloak.test.local/certs';
      process.env.AUTH_DEV_TOKEN_PROVIDER_ENABLED = 'true';

      const externalJwksProvider = new DevTokenProviderService();
      expect(externalJwksProvider.isEnabled()).toBe(false);
      expect(() => externalJwksProvider.issueToken({ role: 'OPERADOR' })).toThrow();
    });

    it('emite un JWT RS256 real verificable criptográficamente en desarrollo', async () => {
      process.env.NODE_ENV = 'development';
      process.env.AUTH_DEV_TOKEN_PROVIDER_ENABLED = 'true';
      delete process.env.AUTH_JWKS_URI;
      delete process.env.AUTH_JWT_ISSUER;
      delete process.env.AUTH_JWT_AUDIENCE;

      const provider = new DevTokenProviderService();
      expect(provider.isEnabled()).toBe(true);
      expect(provider.getJwks().keys).toHaveLength(1);

      const issued = provider.issueToken({ role: 'SERVICIO', sub: 'm8-frontend-simulator' });
      const devVerifier = new JwtAuthService(provider);
      const identity = await devVerifier.verifyAuthorizationHeader(`Bearer ${issued.access_token}`);

      expect(identity).toMatchObject({
        authenticated: true,
        sub: 'm8-frontend-simulator',
        rol: 'SERVICIO',
        roles: ['SERVICIO'],
      });
    });
  });
});
