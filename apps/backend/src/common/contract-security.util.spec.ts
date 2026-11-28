import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  assertResourceOwnership,
  checkIdempotency,
  parseAndAuthorizeJwt,
  saveIdempotency,
} from './contract-security.util';
import type { RedisService } from './redis.service';

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `Bearer eyJhbGciOiJIUzI1NiJ9.${encoded}.sig`;
}

describe('contract-security.util', () => {
  describe('parseAndAuthorizeJwt', () => {
    it('permite paso en modo permisivo cuando no se envía Authorization', () => {
      expect(parseAndAuthorizeJwt(undefined, ['SERVICIO'])).toEqual({
        authenticated: false,
      });
      expect(parseAndAuthorizeJwt('   ', ['CLIENTE'])).toEqual({
        authenticated: false,
      });
    });

    it('rechaza con 401 encabezados sin esquema Bearer, malformados o payloads inválidos', () => {
      expect(() => parseAndAuthorizeJwt('Basic abc123')).toThrow(UnauthorizedException);
      expect(() => parseAndAuthorizeJwt('Bearer solo-una-parte')).toThrow(UnauthorizedException);
      expect(() => parseAndAuthorizeJwt('Bearer hdr.!!!invalido!!!.sig')).toThrow(
        UnauthorizedException,
      );
    });

    it('rechaza con 401 un token expirado (exp en el pasado)', () => {
      const expired = makeJwt({
        sub: 'usr-1',
        rol: 'CLIENTE',
        exp: Math.floor(Date.now() / 1000) - 60,
      });
      expect(() => parseAndAuthorizeJwt(expired, ['CLIENTE'])).toThrow(UnauthorizedException);
    });

    it('extrae sub y rol desde payload.rol, payload.role o payload.roles[0]', () => {
      const future = Math.floor(Date.now() / 1000) + 300;
      expect(parseAndAuthorizeJwt(makeJwt({ sub: 'u1', rol: 'cliente', exp: future }), ['CLIENTE'])).toEqual({
        authenticated: true,
        sub: 'u1',
        rol: 'CLIENTE',
      });
      expect(parseAndAuthorizeJwt(makeJwt({ sub: 'u2', role: 'operador' }), ['OPERADOR'])).toEqual({
        authenticated: true,
        sub: 'u2',
        rol: 'OPERADOR',
      });
      expect(parseAndAuthorizeJwt(makeJwt({ sub: 'u3', roles: ['servicio'] }), ['SERVICIO'])).toEqual({
        authenticated: true,
        sub: 'u3',
        rol: 'SERVICIO',
      });
    });

    it('rechaza con 403 cuando el rol del token no está incluido en allowedRoles', () => {
      const clienteJwt = makeJwt({ sub: 'usr-1', rol: 'CLIENTE' });
      expect(() => parseAndAuthorizeJwt(clienteJwt, ['SERVICIO', 'OPERADOR'])).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('assertResourceOwnership', () => {
    it('lanza 403 cuando un CLIENTE o CONDUCTOR autenticado intenta acceder a un recurso ajeno', () => {
      expect(() =>
        assertResourceOwnership({ authenticated: true, sub: 'usr-1', rol: 'CLIENTE' }, 'usr-2'),
      ).toThrow(ForbiddenException);

      expect(() =>
        assertResourceOwnership({ authenticated: true, sub: 'drv-1', rol: 'CONDUCTOR' }, 'drv-2'),
      ).toThrow(ForbiddenException);
    });

    it('permite acceso al propietario o a roles administrativos (OPERADOR / SERVICIO)', () => {
      expect(() =>
        assertResourceOwnership({ authenticated: true, sub: 'usr-1', rol: 'CLIENTE' }, 'usr-1'),
      ).not.toThrow();

      expect(() =>
        assertResourceOwnership({ authenticated: true, sub: 'op-1', rol: 'OPERADOR' }, 'usr-2'),
      ).not.toThrow();

      expect(() =>
        assertResourceOwnership({ authenticated: false }, 'usr-2'),
      ).not.toThrow();
    });
  });

  describe('checkIdempotency & saveIdempotency', () => {
    it('valida longitud de Idempotency-Key (vacía o >255 lanza 400)', async () => {
      const store = new Map<string, { hash: string; response: unknown }>();
      await expect(checkIdempotency(store, undefined, 'qr', '   ', 'h1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        checkIdempotency(store, undefined, 'qr', 'k'.repeat(256), 'h1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('retorna respuesta cacheada con igual hash y lanza 422 si cambia el hash', async () => {
      const store = new Map<string, { hash: string; response: { ok: boolean } }>();
      const redisMock = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
      } as unknown as RedisService;

      expect(await checkIdempotency(store, redisMock, 'ticket', 'idem-1', 'hash-A')).toBeNull();

      await saveIdempotency(store, redisMock, 'ticket', 'idem-1', 'hash-A', { ok: true }, 120);
      expect(redisMock.set).toHaveBeenCalledWith(
        'idem:ticket:idem-1',
        JSON.stringify({ hash: 'hash-A', response: { ok: true } }),
        120,
      );

      expect(await checkIdempotency(store, redisMock, 'ticket', 'idem-1', 'hash-A')).toEqual({
        ok: true,
      });

      await expect(
        checkIdempotency(store, redisMock, 'ticket', 'idem-1', 'hash-B'),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('consulta respaldo en Redis cuando la memoria local está vacía', async () => {
      const store = new Map<string, { hash: string; response: { id: string } }>();
      const redisMock = {
        get: jest.fn().mockResolvedValue(JSON.stringify({ hash: 'h-redis', response: { id: 'r1' } })),
        set: jest.fn(),
      } as unknown as RedisService;

      expect(await checkIdempotency(store, redisMock, 'qr-val', 'idem-r1', 'h-redis')).toEqual({
        id: 'r1',
      });
    });
  });
});
