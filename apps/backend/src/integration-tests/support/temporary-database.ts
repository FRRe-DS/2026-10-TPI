import { PrismaClient } from '@prisma/client';
import {
  assertTemporaryDatabaseIdentity,
  assertTemporaryDatabaseUrl,
} from './temporary-database.guard';

/** Tablas del esquema Prisma actual (ver prisma/schema.prisma). Lista explícita: nada dinámico. */
const TABLES = [
  'TicketMessage',
  'SupportTicket',
  'DocumentReceipt',
  'QrVerificationToken',
  'NotificationLog',
] as const;

interface IdentityRow {
  db: string | null;
  usr: string | null;
  marker: string | null;
}

/**
 * Operaciones de preparación/limpieza de datos. Toda operación destructiva pasa por
 * `verifyIdentity()`: valida la URL y consulta la identidad REAL de la base conectada
 * (current_database(), current_user y marcador de la corrida) antes de ejecutar.
 */
export class TemporaryDatabase {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly url: string,
    private readonly runId: string,
  ) {}

  async verifyIdentity(): Promise<void> {
    assertTemporaryDatabaseUrl(this.url);
    const rows = await this.prisma.$queryRaw<IdentityRow[]>`
      SELECT current_database() AS db,
             current_user AS usr,
             shobj_description(
               (SELECT oid FROM pg_database WHERE datname = current_database()),
               'pg_database'
             ) AS marker
    `;
    const row = rows[0];
    assertTemporaryDatabaseIdentity(
      { database: row?.db ?? null, user: row?.usr ?? null, marker: row?.marker ?? null },
      this.runId,
    );
  }

  /** Vacía todas las tablas de la base temporal (aislamiento entre pruebas). */
  async reset(): Promise<void> {
    await this.verifyIdentity();
    const list = TABLES.map((table) => `"public"."${table}"`).join(', ');
    await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
}
