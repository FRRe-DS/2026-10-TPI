import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const apiPrefix = process.env.API_PREFIX || 'api/v1';
  app.setGlobalPrefix(apiPrefix);

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

  const config = new DocumentBuilder()
    .setTitle('Módulo 8: Notificaciones, Documentos y Soporte (G10-M8)')
    .setDescription(
      'API REST del Módulo 8 para la Plataforma Distribuida de Movilidad Urbana.',
    )
    .setVersion('1.0.0')
    .addTag('Health')
    .addTag('Notificaciones')
    .addTag('Documentos y QR')
    .addTag('Soporte y Tickets')
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
