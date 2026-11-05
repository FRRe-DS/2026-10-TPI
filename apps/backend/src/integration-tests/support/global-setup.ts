import { startTemporaryPostgres, StartedTemporaryPostgres } from './postgres-test-environment';
import { TEST_DB_RUN_ID_ENV, TEST_DB_URL_ENV } from './temporary-database.guard';

/**
 * Jest globalSetup: se ejecuta UNA vez antes de todas las suites de integración.
 * Levanta un único PostgreSQL temporal compartido por las suites (ejecutadas con
 * --runInBand) y publica su URL en variables de entorno propias de la suite.
 *
 * Si la preparación falla, `startTemporaryPostgres` ya detuvo el contenedor y Jest
 * aborta la ejecución sin ejecutar pruebas.
 */
export default async function globalSetup(): Promise<void> {
  const started = await startTemporaryPostgres();
  (globalThis as { __M8_TEMP_POSTGRES__?: StartedTemporaryPostgres }).__M8_TEMP_POSTGRES__ =
    started;
  process.env[TEST_DB_URL_ENV] = started.url;
  process.env[TEST_DB_RUN_ID_ENV] = started.runId;
}
