/**
 * Guardián de seguridad para las pruebas de integración (Tema 25).
 *
 * Funciones puras, SIN dependencias de Docker, Prisma ni Testcontainers, para
 * poder probarlas en la suite unitaria. Su objetivo es garantizar que cualquier
 * preparación o limpieza de datos (TRUNCATE) opere únicamente sobre la base
 * PostgreSQL temporal creada por Testcontainers y jamás sobre Supabase u otra
 * base compartida.
 *
 * Defensa en profundidad (todas las capas deben pasar):
 *  1. La URL debe ser postgres(ql)://, usar el usuario y la base "centinela"
 *     reservados para esta suite, y no apuntar a hosts de Supabase/pooler.
 *  2. La URL no puede tener el mismo host:puerto que cualquier URL PostgreSQL
 *     presente en las variables de entorno (DATABASE_URL, DIRECT_URL, ...).
 *  3. Ya conectado, la base debe identificarse con un marcador (COMMENT ON
 *     DATABASE) que escribe únicamente el arranque del contenedor, con un
 *     identificador único de la corrida (runId).
 */

export const TEMP_DB_NAME = 'm8_integration_test';
export const TEMP_DB_USER = 'm8_test_user';
export const TEMP_DB_MARKER_PREFIX = 'm8-testcontainers-temporary:';

/** Variable de entorno exclusiva de la suite: se ignora al buscar bases protegidas. */
export const TEST_DB_URL_ENV = 'M8_TEST_DATABASE_URL';
export const TEST_DB_RUN_ID_ENV = 'M8_TEST_DATABASE_RUN_ID';

export class UnsafeDatabaseTargetError extends Error {
  constructor(reason: string) {
    super(
      `Operación abortada: la base de datos no es la temporal de Testcontainers. ${reason}`,
    );
    this.name = 'UnsafeDatabaseTargetError';
  }
}

const POSTGRES_URL_PATTERN = /^postgres(ql)?:\/\//i;
const FORBIDDEN_HOST_FRAGMENTS = ['supabase', 'pooler'];

function parsePostgresUrl(value: string): URL | null {
  if (!POSTGRES_URL_PATTERN.test(value.trim())) return null;
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

function hostAndPort(url: URL): string {
  return `${url.hostname.toLowerCase()}:${url.port || '5432'}`;
}

/**
 * Valida la URL candidata ANTES de conectarse. No incluye la URL en los
 * mensajes de error para no filtrar credenciales.
 */
export function assertTemporaryDatabaseUrl(
  candidateUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const candidate = parsePostgresUrl(candidateUrl ?? '');
  if (!candidate) {
    throw new UnsafeDatabaseTargetError('La URL no es una URL postgres(ql):// válida.');
  }

  const database = decodeURIComponent(candidate.pathname.replace(/^\//, ''));
  if (database !== TEMP_DB_NAME) {
    throw new UnsafeDatabaseTargetError(
      `El nombre de la base debe ser "${TEMP_DB_NAME}".`,
    );
  }

  if (decodeURIComponent(candidate.username) !== TEMP_DB_USER) {
    throw new UnsafeDatabaseTargetError(
      `El usuario debe ser "${TEMP_DB_USER}".`,
    );
  }

  const hostname = candidate.hostname.toLowerCase();
  if (FORBIDDEN_HOST_FRAGMENTS.some((fragment) => hostname.includes(fragment))) {
    throw new UnsafeDatabaseTargetError('El host corresponde a un servicio gestionado (Supabase/pooler).');
  }

  const candidateHostPort = hostAndPort(candidate);
  for (const [key, value] of Object.entries(env)) {
    if (!value || key === TEST_DB_URL_ENV) continue;
    if (value === candidateUrl) continue; // misma URL temporal reexportada por el arnés
    const other = parsePostgresUrl(value);
    if (other && hostAndPort(other) === candidateHostPort) {
      throw new UnsafeDatabaseTargetError(
        `El host:puerto coincide con la variable de entorno ${key}, que apunta a otra base.`,
      );
    }
  }
}

export interface DatabaseIdentity {
  database: string | null;
  user: string | null;
  marker: string | null;
}

/** Valida la identidad real de la base ya conectada (current_database, usuario y marcador). */
export function assertTemporaryDatabaseIdentity(
  identity: DatabaseIdentity,
  expectedRunId: string,
): void {
  if (!expectedRunId) {
    throw new UnsafeDatabaseTargetError('Falta el identificador de corrida (runId).');
  }
  if (identity.database !== TEMP_DB_NAME) {
    throw new UnsafeDatabaseTargetError(
      `current_database() devolvió "${identity.database}" en lugar de "${TEMP_DB_NAME}".`,
    );
  }
  if (identity.user !== TEMP_DB_USER) {
    throw new UnsafeDatabaseTargetError(
      `current_user devolvió "${identity.user}" en lugar de "${TEMP_DB_USER}".`,
    );
  }
  if (identity.marker !== `${TEMP_DB_MARKER_PREFIX}${expectedRunId}`) {
    throw new UnsafeDatabaseTargetError(
      'La base no tiene el marcador de base temporal de esta corrida.',
    );
  }
}
