import {
  TEMP_DB_MARKER_PREFIX,
  TEMP_DB_NAME,
  TEMP_DB_USER,
  UnsafeDatabaseTargetError,
  assertTemporaryDatabaseIdentity,
  assertTemporaryDatabaseUrl,
} from './temporary-database.guard';

/**
 * Pruebas UNITARIAS del guardián de seguridad: no requieren Docker ni base de datos.
 * Se ejecutan junto con el resto de la suite unitaria (`npm test`).
 */
describe('temporary-database.guard (sin Docker)', () => {
  const validUrl = `postgres://${TEMP_DB_USER}:s3cr3t@localhost:49321/${TEMP_DB_NAME}`;

  describe('assertTemporaryDatabaseUrl', () => {
    it('acepta la URL de la base temporal con puerto dinámico', () => {
      expect(() => assertTemporaryDatabaseUrl(validUrl, {})).not.toThrow();
    });

    it('rechaza una URL que no es PostgreSQL', () => {
      expect(() => assertTemporaryDatabaseUrl('mysql://u:p@localhost/db', {})).toThrow(
        UnsafeDatabaseTargetError,
      );
      expect(() => assertTemporaryDatabaseUrl('', {})).toThrow(UnsafeDatabaseTargetError);
    });

    it('rechaza una base con otro nombre (ej. "postgres" de Supabase)', () => {
      expect(() =>
        assertTemporaryDatabaseUrl(
          `postgresql://${TEMP_DB_USER}:x@localhost:5432/postgres`,
          {},
        ),
      ).toThrow(/nombre de la base/);
    });

    it('rechaza un usuario distinto al reservado para la suite', () => {
      expect(() =>
        assertTemporaryDatabaseUrl(`postgresql://postgres:x@localhost:5432/${TEMP_DB_NAME}`, {}),
      ).toThrow(/usuario/);
    });

    it('rechaza hosts de Supabase o de pooler', () => {
      expect(() =>
        assertTemporaryDatabaseUrl(
          `postgresql://${TEMP_DB_USER}:x@db.abcd.supabase.co:5432/${TEMP_DB_NAME}`,
          {},
        ),
      ).toThrow(/Supabase/);
      expect(() =>
        assertTemporaryDatabaseUrl(
          `postgresql://${TEMP_DB_USER}:x@aws-0-sa-east-1.pooler.example.com:6543/${TEMP_DB_NAME}`,
          {},
        ),
      ).toThrow(/Supabase|pooler/);
    });

    it('rechaza si host:puerto coincide con DATABASE_URL o DIRECT_URL del entorno', () => {
      const env = {
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:49321/m8_db',
      } as NodeJS.ProcessEnv;
      expect(() => assertTemporaryDatabaseUrl(validUrl, env)).toThrow(/DATABASE_URL/);

      const direct = {
        DIRECT_URL: 'postgresql://postgres:postgres@LOCALHOST:49321/m8_db',
      } as NodeJS.ProcessEnv;
      expect(() => assertTemporaryDatabaseUrl(validUrl, direct)).toThrow(/DIRECT_URL/);
    });

    it('no confunde otra base local en un puerto distinto con la temporal', () => {
      const env = {
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/m8_db',
      } as NodeJS.ProcessEnv;
      expect(() => assertTemporaryDatabaseUrl(validUrl, env)).not.toThrow();
    });

    it('ignora la variable propia de la suite y la reexportación idéntica de la URL temporal', () => {
      const env = {
        M8_TEST_DATABASE_URL: validUrl,
        DATABASE_URL: validUrl,
        DIRECT_URL: validUrl,
      } as NodeJS.ProcessEnv;
      expect(() => assertTemporaryDatabaseUrl(validUrl, env)).not.toThrow();
    });

    it('no incluye la URL ni la contraseña en el mensaje de error', () => {
      let message: string | undefined;
      try {
        assertTemporaryDatabaseUrl(`postgresql://postgres:topsecret@localhost:5432/postgres`, {});
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBeDefined();
      expect(message).not.toContain('topsecret');
      expect(message).not.toContain('postgresql://');
    });
  });

  describe('assertTemporaryDatabaseIdentity', () => {
    const runId = 'run-1234';
    const goodIdentity = {
      database: TEMP_DB_NAME,
      user: TEMP_DB_USER,
      marker: `${TEMP_DB_MARKER_PREFIX}${runId}`,
    };

    it('acepta la identidad esperada de la corrida', () => {
      expect(() => assertTemporaryDatabaseIdentity(goodIdentity, runId)).not.toThrow();
    });

    it('rechaza otra base, otro usuario, marcador ajeno o sin marcador', () => {
      expect(() =>
        assertTemporaryDatabaseIdentity({ ...goodIdentity, database: 'postgres' }, runId),
      ).toThrow(UnsafeDatabaseTargetError);
      expect(() =>
        assertTemporaryDatabaseIdentity({ ...goodIdentity, user: 'postgres' }, runId),
      ).toThrow(UnsafeDatabaseTargetError);
      expect(() =>
        assertTemporaryDatabaseIdentity(
          { ...goodIdentity, marker: `${TEMP_DB_MARKER_PREFIX}otra-corrida` },
          runId,
        ),
      ).toThrow(/marcador/);
      expect(() =>
        assertTemporaryDatabaseIdentity({ ...goodIdentity, marker: null }, runId),
      ).toThrow(/marcador/);
    });

    it('rechaza si falta el runId', () => {
      expect(() => assertTemporaryDatabaseIdentity(goodIdentity, '')).toThrow(/runId/);
    });
  });
});
