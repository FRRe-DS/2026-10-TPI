import { execFile } from 'child_process';
import { randomBytes, randomUUID } from 'crypto';
import { cpSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { promisify } from 'util';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  TEMP_DB_MARKER_PREFIX,
  TEMP_DB_NAME,
  TEMP_DB_USER,
  assertTemporaryDatabaseUrl,
} from './temporary-database.guard';

const execFileAsync = promisify(execFile);

/** Misma versión mayor que el docker-compose.yml del Tema 14 (postgres:16-alpine). */
const DEFAULT_POSTGRES_IMAGE = 'postgres:16-alpine';

/** Carpeta `apps/backend/prisma` (válido desde src/ y desde dist/, ambos a 3 niveles). */
const PRISMA_DIR = resolve(__dirname, '../../../prisma');

export interface StartedTemporaryPostgres {
  /** URL de conexión obtenida EXCLUSIVAMENTE del contenedor (host y puerto dinámicos). */
  readonly url: string;
  /** Identificador único de la corrida; se escribe como marcador en la base. */
  readonly runId: string;
  stop(): Promise<void>;
}

function redact(text: string, secrets: string[]): string {
  return secrets.reduce(
    (acc, secret) => (secret ? acc.split(secret).join('<redacted>') : acc),
    text,
  );
}

/**
 * Aplica las migraciones EXISTENTES (`prisma migrate deploy`) sobre la base temporal.
 *
 * Se copia `schema.prisma` + `migrations/` a una carpeta temporal y se ejecuta la CLI
 * desde allí con DATABASE_URL/DIRECT_URL apuntando al contenedor. Así la CLI de Prisma
 * no encuentra ni carga ningún `.env` del repositorio.
 */
async function applyMigrations(url: string): Promise<void> {
  const workDir = mkdtempSync(join(tmpdir(), 'm8-it-prisma-'));
  try {
    cpSync(join(PRISMA_DIR, 'schema.prisma'), join(workDir, 'prisma', 'schema.prisma'));
    cpSync(join(PRISMA_DIR, 'migrations'), join(workDir, 'prisma', 'migrations'), {
      recursive: true,
    });

    const prismaCli = require.resolve('prisma/build/index.js');
    try {
      await execFileAsync(
        process.execPath,
        [prismaCli, 'migrate', 'deploy', '--schema', join(workDir, 'prisma', 'schema.prisma')],
        {
          cwd: workDir,
          env: {
            ...process.env,
            DATABASE_URL: url,
            DIRECT_URL: url,
            CHECKPOINT_DISABLE: '1',
            PRISMA_HIDE_UPDATE_MESSAGE: '1',
          },
          timeout: 120_000,
        },
      );
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message: string };
      const detail = redact(`${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message}`, [url]);
      throw new Error(`Falló "prisma migrate deploy" sobre la base temporal:\n${detail}`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** Marca la base como temporal de esta corrida (verificado luego antes de cada limpieza). */
async function markDatabase(url: string, runId: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    // runId es un UUID generado localmente (sin comillas ni caracteres especiales).
    await prisma.$executeRawUnsafe(
      `COMMENT ON DATABASE "${TEMP_DB_NAME}" IS '${TEMP_DB_MARKER_PREFIX}${runId}'`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Levanta un PostgreSQL real y efímero con Testcontainers, aplica las migraciones y
 * lo marca como temporal. Si algo falla durante la preparación, el contenedor se
 * detiene antes de propagar el error.
 */
export async function startTemporaryPostgres(): Promise<StartedTemporaryPostgres> {
  const runId = randomUUID();
  const password = randomBytes(16).toString('hex');
  const image = process.env.M8_TEST_POSTGRES_IMAGE || DEFAULT_POSTGRES_IMAGE;

  let container: Awaited<ReturnType<PostgreSqlContainer['start']>>;
  try {
    container = await new PostgreSqlContainer(image)
      .withDatabase(TEMP_DB_NAME)
      .withUsername(TEMP_DB_USER)
      .withPassword(password)
      .start(); // sin puertos fijos: Docker asigna un puerto libre del host
  } catch (error) {
    throw new Error(
      'No se pudo iniciar el contenedor PostgreSQL con Testcontainers. ' +
        'Verificá que Docker (o un runtime compatible) esté instalado y en ejecución. ' +
        `Detalle: ${(error as Error).message}`,
    );
  }

  const stop = async () => {
    await container.stop(); // detiene y elimina el contenedor
  };

  try {
    const url = container.getConnectionUri();
    assertTemporaryDatabaseUrl(url);
    await applyMigrations(url);
    await markDatabase(url, runId);
    return { url, runId, stop };
  } catch (error) {
    await stop().catch(() => undefined);
    throw error;
  }
}
