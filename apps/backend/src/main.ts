import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Cargar variables de entorno desde la raíz del monorepo y/o directorio actual
dotenv.config({ path: resolve(__dirname, '../../../.env') });
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import {
  ValidationPipe,
  Logger,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HealthController } from './modules/health/health.controller';
import {
  ProblemDetailsFilter,
  resolveRequestId,
} from './common/problem-details.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  const apiPrefix = process.env.API_PREFIX || 'api/v1';
  app.setGlobalPrefix(apiPrefix);

  // Correlación X-Request-Id en todas las respuestas (Contrato Coordinado Definitivo M8)
  app.use((req: any, res: any, next: () => void) => {
    const requestId = resolveRequestId(req.headers?.['x-request-id']);
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });

  // Validación de Content-Type application/json (415) y límite de 1 MiB (413)
  app.use((req: any, _res: any, next: (err?: any) => void) => {
    const method = (req.method || '').toUpperCase();
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const contentType = req.headers?.['content-type'];
      const contentLength = Number(req.headers?.['content-length'] ?? 0);
      if (
        contentType &&
        contentLength > 0 &&
        !String(contentType).toLowerCase().includes('application/json')
      ) {
        return next(
          new UnsupportedMediaTypeException(
            'El Content-Type del cuerpo debe ser application/json.',
          ),
        );
      }
    }
    next();
  });

  app.useBodyParser('json', { limit: '1mb' });

  // Soporte directo para GET /health en la raíz además de /api/v1/health
  const httpAdapter = app.getHttpAdapter();
  const healthController = app.get(HealthController);
  httpAdapter.get('/health', async (_req: any, res: any) => {
    const body = await healthController.check();
    res.status(200).json(body);
  });

  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new ProblemDetailsFilter());

  const config = new DocumentBuilder()
    .setTitle('DS 2026 API - Módulo 8: Notificaciones, Documentos y Soporte')
    .setDescription(
      'API de Notificaciones, Documentos y Soporte (M8). Contrato común acordado entre el Grupo 7 y el Grupo 10.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addTag('Salud')
    .addTag('Eventos')
    .addTag('Notificaciones')
    .addTag('QR')
    .addTag('Comprobantes')
    .addTag('Tickets')
    .addTag('Simulador de Eventos')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Servidor M8 iniciado en puerto ${port} (${apiPrefix})`);
  logger.log(`Documentación Swagger en http://localhost:${port}/api/docs`);
}

bootstrap();
