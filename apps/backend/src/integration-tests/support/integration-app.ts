import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import type { Response } from 'superagent';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { NotificationSenderPort } from '../../modules/notifications/domain/ports/notification-sender.port';
import { TripCompletedConsumer } from '../../modules/notifications/infrastructure/messaging/trip-completed.consumer';
import {
  InMemoryRedisDouble,
  NoopTripCompletedConsumer,
  RecordingNotificationSender,
} from './test-doubles';
import {
  TEST_DB_RUN_ID_ENV,
  TEST_DB_URL_ENV,
  assertTemporaryDatabaseUrl,
} from './temporary-database.guard';
import { TemporaryDatabase } from './temporary-database';

export interface IntegrationApp {
  app: INestApplication;
  /** Cliente PrismaService REAL conectado a la base temporal (también usado por la app). */
  prisma: PrismaService;
  /** Preparación/limpieza protegida por el guardián. */
  database: TemporaryDatabase;
  /** Doble del puerto de correo (registra mensajes en memoria). */
  mailer: RecordingNotificationSender;
  /** Cliente HTTP (supertest) contra la aplicación NestJS de prueba. */
  http(): ReturnType<typeof request>;
  close(): Promise<void>;
}

/**
 * Crea la aplicación NestJS COMPLETA (AppModule real) conectada a la base temporal.
 *
 * Reales: controladores, validación, casos de uso, repositorios Prisma, PrismaService y
 * PostgreSQL (Testcontainers).
 * Reemplazados por dobles (FUERA del alcance de esta suite): SMTP, Redis y RabbitMQ.
 *
 * La conexión proviene exclusivamente del contenedor (variables que publica el
 * globalSetup). No se carga ningún `.env` ni se conecta a Supabase.
 */
export async function createIntegrationApp(): Promise<IntegrationApp> {
  const url = process.env[TEST_DB_URL_ENV];
  const runId = process.env[TEST_DB_RUN_ID_ENV];
  if (!url || !runId) {
    throw new Error(
      'No hay base temporal disponible. Ejecutá las pruebas con "npm run test:integration" ' +
        '(el globalSetup de Jest levanta PostgreSQL con Testcontainers).',
    );
  }

  // Guardián previo a cualquier conexión.
  assertTemporaryDatabaseUrl(url);

  // Cualquier cliente Prisma accidental usará la base temporal, nunca una base compartida.
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = url;

  const prisma = new PrismaService({ datasourceUrl: url });
  const mailer = new RecordingNotificationSender();
  let app: INestApplication | undefined;

  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(RedisService)
      .useValue(new InMemoryRedisDouble())
      .overrideProvider(NotificationSenderPort)
      .useValue(mailer)
      .overrideProvider(TripCompletedConsumer)
      .useValue(new NoopTripCompletedConsumer())
      .compile();

    app = moduleRef.createNestApplication();
    // Misma configuración HTTP que apps/backend/src/main.ts (prefijo y validación global).
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    const database = new TemporaryDatabase(prisma, url, runId);
    await database.verifyIdentity(); // falla rápido si no es la base temporal

    const running = app;
    return {
      app: running,
      prisma,
      database,
      mailer,
      http: () => request(running.getHttpServer()),
      close: async () => {
        try {
          await running.close();
        } finally {
          await prisma.$disconnect();
        }
      },
    };
  } catch (error) {
    // Liberar recursos aunque falle la preparación.
    try {
      await app?.close();
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
    throw error;
  }
}

/** Parser binario de supertest para descargas (PDF). */
export function binaryParser(
  res: Response,
  callback: (err: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.setEncoding('binary');
  res.on('data', (chunk: string) => chunks.push(Buffer.from(chunk, 'binary')));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}
