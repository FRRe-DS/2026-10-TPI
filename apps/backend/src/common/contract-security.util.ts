import {
  BadRequestException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RedisService } from './redis.service';

export interface JwtIdentity {
  authenticated: boolean;
  sub?: string;
  rol?: string;
  roles?: string[];
}

const PRIVILEGED_ROLES = new Set(['OPERADOR', 'SERVICIO']);

/**
 * Obtiene la lista normalizada en mayúsculas de roles presentes en una identidad verificada.
 */
export function getIdentityRoles(identity?: JwtIdentity): string[] {
  if (!identity) {
    return [];
  }
  const set = new Set<string>();
  if (Array.isArray(identity.roles)) {
    for (const r of identity.roles) {
      if (typeof r === 'string' && r.trim()) {
        set.add(r.trim().toUpperCase());
      }
    }
  }
  if (typeof identity.rol === 'string' && identity.rol.trim()) {
    set.add(identity.rol.trim().toUpperCase());
  }
  return Array.from(set);
}

/**
 * Indica si una identidad verificada posee un rol específico (case-insensitive).
 */
export function hasIdentityRole(identity: JwtIdentity | undefined, role: string): boolean {
  return getIdentityRoles(identity).includes(role.trim().toUpperCase());
}

/**
 * Verifica que un CLIENTE o CONDUCTOR autenticado solo acceda a sus propios recursos (403 si es de otro).
 * Los roles privilegiados (OPERADOR, SERVICIO) pueden operar sobre recursos de terceros según contrato.
 */
export function assertResourceOwnership(
  identity: JwtIdentity | undefined,
  resourceOwnerId: string | undefined,
  restrictedRoles: string[] = ['CLIENTE', 'CONDUCTOR'],
): void {
  if (!identity?.authenticated || !identity.sub || !resourceOwnerId) {
    return;
  }

  const roles = getIdentityRoles(identity);
  if (roles.some((r) => PRIVILEGED_ROLES.has(r))) {
    return;
  }

  const normalizedRestricted = restrictedRoles.map((r) => r.toUpperCase());
  const isRestricted = roles.some((r) => normalizedRestricted.includes(r));
  if (isRestricted && identity.sub !== resourceOwnerId) {
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
