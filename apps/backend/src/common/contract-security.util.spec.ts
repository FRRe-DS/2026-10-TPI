import {
  BadRequestException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  assertResourceOwnership,
  checkIdempotency,
  getIdentityRoles,
  hasIdentityRole,
  saveIdempotency,
} from './contract-security.util';
import type { RedisService } from './redis.service';

describe('contract-security.util', () => {
  describe('getIdentityRoles & hasIdentityRole', () => {
    it('normaliza roles en mayúsculas combinando roles[] y rol', () => {
      const identity = {
        authenticated: true,
        sub: 'usr-1',
        rol: 'cliente',
        roles: ['cliente', 'operador'],
      };
      expect(getIdentityRoles(identity)).toEqual(['CLIENTE', 'OPERADOR']);
      expect(hasIdentityRole(identity, 'OPERADOR')).toBe(true);
      expect(hasIdentityRole(identity, 'SERVICIO')).toBe(false);
    });

    it('devuelve lista vacía cuando no hay identidad', () => {
      expect(getIdentityRoles(undefined)).toEqual([]);
      expect(hasIdentityRole(undefined, 'CLIENTE')).toBe(false);
    });
  });

  describe('assertResourceOwnership', () => {
    it('lanza 403 cuando un CLIENTE o CONDUCTOR autenticado intenta acceder a un recurso ajeno', () => {
      expect(() =>
        assertResourceOwnership(
          { authenticated: true, sub: 'usr-1', rol: 'CLIENTE', roles: ['CLIENTE'] },
          'usr-2',
        ),
      ).toThrow(ForbiddenException);

      expect(() =>
        assertResourceOwnership(
          { authenticated: true, sub: 'drv-1', rol: 'CONDUCTOR', roles: ['CONDUCTOR'] },
          'drv-2',
        ),
      ).toThrow(ForbiddenException);
    });

    it('permite acceso al propietario o a roles administrativos (OPERADOR / SERVICIO)', () => {
      expect(() =>
        assertResourceOwnership(
          { authenticated: true, sub: 'usr-1', rol: 'CLIENTE', roles: ['CLIENTE'] },
          'usr-1',
        ),
      ).not.toThrow();

      expect(() =>
        assertResourceOwnership(
          { authenticated: true, sub: 'op-1', rol: 'OPERADOR', roles: ['OPERADOR'] },
          'usr-2',
        ),
      ).not.toThrow();

      expect(() =>
        assertResourceOwnership(
          { authenticated: true, sub: 'm6', rol: 'SERVICIO', roles: ['CLIENTE', 'SERVICIO'] },
          'usr-2',
        ),
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
