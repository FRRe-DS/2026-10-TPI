import { StartedTemporaryPostgres } from './postgres-test-environment';
import { TEST_DB_RUN_ID_ENV, TEST_DB_URL_ENV } from './temporary-database.guard';

/**
 * Jest globalTeardown: detiene y elimina el contenedor PostgreSQL temporal.
 * Jest lo invoca al terminar la corrida, también cuando hay pruebas que fallan.
 * Si el proceso se interrumpe abruptamente, el contenedor "Ryuk" de Testcontainers
 * elimina los recursos huérfanos.
 */
export default async function globalTeardown(): Promise<void> {
  const holder = globalThis as { __M8_TEMP_POSTGRES__?: StartedTemporaryPostgres };
  const started = holder.__M8_TEMP_POSTGRES__;
  holder.__M8_TEMP_POSTGRES__ = undefined;
  delete process.env[TEST_DB_URL_ENV];
  delete process.env[TEST_DB_RUN_ID_ENV];
  if (started) {
    await started.stop();
  }
}
