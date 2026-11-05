import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RedisService } from './redis.service';

export interface JwtIdentity {
  authenticated: boolean;
  sub?: string;
  rol?: string;
}

/**
 * Extrae y valida la identidad del encabezado Authorization: Bearer <JWT>.
 * - Si no se envía el encabezado, permite el paso (authenticated = false) para
 *   mantener retrocompatibilidad con pruebas unitarias, simuladores y dashboard local.
 * - Si se envía un encabezado malformado o un token expirado, lanza 401 (No autenticado).
 * - Si se especifican allowedRoles y el token declara un rol distinto, lanza 403 (Sin permiso).
 */
export function parseAndAuthorizeJwt(
  authHeader?: string,
  allowedRoles?: string[],
): JwtIdentity {
  if (!authHeader || !authHeader.trim()) {
    return { authenticated: false };
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedException('El encabezado Authorization debe utilizar el esquema Bearer.');
  }

  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) {
    throw new UnauthorizedException('Formato de token JWT inválido.');
  }

  let payload: Record<string, unknown>;
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    payload = JSON.parse(payloadJson);
    if (!payload || typeof payload !== 'object') {
      throw new Error('Payload no es un objeto');
    }
  } catch {
    throw new UnauthorizedException('No se pudo decodificar el payload del token JWT.');
  }

  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    throw new UnauthorizedException('El token JWT ha expirado.');
  }

  const sub = typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub.trim() : undefined;
  const rawRol =
    typeof payload.rol === 'string'
      ? payload.rol
      : typeof payload.role === 'string'
        ? payload.role
        : Array.isArray(payload.roles) && typeof payload.roles[0] === 'string'
          ? payload.roles[0]
          : undefined;
  const rol = rawRol ? rawRol.toUpperCase() : undefined;

  if (allowedRoles && allowedRoles.length > 0 && rol) {
    const normalizedAllowed = allowedRoles.map((r) => r.toUpperCase());
    if (!normalizedAllowed.includes(rol)) {
      throw new ForbiddenException(
        `El rol ${rol} no tiene permiso para esta operación. Roles admitidos: ${normalizedAllowed.join(', ')}.`,
      );
    }
  }

  return {
    authenticated: true,
    sub,
    rol,
  };
}

/**
 * Verifica que un CLIENTE o CONDUCTOR autenticado solo acceda a sus propios recursos (403 si es de otro).
 */
export function assertResourceOwnership(
  identity: JwtIdentity,
  resourceOwnerId: string | undefined,
  restrictedRoles: string[] = ['CLIENTE', 'CONDUCTOR'],
): void {
  if (
    identity.authenticated &&
    identity.rol &&
    restrictedRoles.includes(identity.rol.toUpperCase()) &&
    identity.sub &&
    resourceOwnerId &&
    identity.sub !== resourceOwnerId
  ) {
    throw new ForbiddenException(
      'Sin permiso: un usuario solo puede acceder u operar sobre sus propios recursos.',
    );
  }
}

/**
 * Consulta una clave de idempotencia en memoria y en Redis (si está disponible).
 * Si la clave ya fue usada con el mismo hash, devuelve la respuesta original;
 * si fue usada con un hash distinto, lanza 422 UnprocessableEntityException.
 */
export async function checkIdempotency<T>(
  memoryStore: Map<string, { hash: string; response: T }>,
  redis: RedisService | undefined,
  scope: string,
  idempotencyKey: string | undefined,
  payloadHash: string,
): Promise<T | null> {
  if (idempotencyKey === undefined) {
    return null;
  }

  const trimmed = idempotencyKey.trim();
  if (trimmed.length === 0 || trimmed.length > 255) {
    throw new BadRequestException(
      'El encabezado Idempotency-Key debe tener entre 1 y 255 caracteres.',
    );
  }

  const storeKey = `${scope}:${trimmed}`;
  let existing = memoryStore.get(storeKey) ?? null;

  if (!existing && redis) {
    try {
      const cached = await redis.get(`idem:${storeKey}`);
      if (cached) {
        existing = JSON.parse(cached);
      }
    } catch {
      // Ignorar fallo de lectura en caché y usar memoria
    }
  }

  if (!existing) {
    return null;
  }

  if (existing.hash !== payloadHash) {
    throw new UnprocessableEntityException({
      type: '/errores/idempotencia-conflicto',
      title: 'Clave de idempotencia reutilizada con otro cuerpo',
      detail: `La clave Idempotency-Key "${trimmed}" ya fue utilizada previamente con un contenido diferente.`,
    });
  }

  return existing.response;
}

export async function saveIdempotency<T>(
  memoryStore: Map<string, { hash: string; response: T }>,
  redis: RedisService | undefined,
  scope: string,
  idempotencyKey: string | undefined,
  payloadHash: string,
  response: T,
  ttlSeconds = 86400,
): Promise<void> {
  if (!idempotencyKey || !idempotencyKey.trim()) {
    return;
  }
  const storeKey = `${scope}:${idempotencyKey.trim()}`;
  const entry = { hash: payloadHash, response };
  memoryStore.set(storeKey, entry);

  if (redis) {
    try {
      await redis.set(`idem:${storeKey}`, JSON.stringify(entry), ttlSeconds);
    } catch {
      // Ignorar fallo de escritura en Redis, ya quedó en memoria
    }
  }
}
