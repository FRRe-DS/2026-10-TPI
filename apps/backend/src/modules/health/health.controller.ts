import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Chequeo de salud del servicio M8' })
  @ApiResponse({ status: 200, description: 'Servicio M8 operativo' })
  @ApiResponse({ status: 503, description: 'PostgreSQL no disponible' })
  async check() {
    let estadoPostgres = 'caido';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      estadoPostgres = 'activo';
    } catch {
      estadoPostgres = 'caido';
    }

    // Si Postgres no responde, devolvemos 503 para que Docker marque el contenedor como unhealthy
    if (estadoPostgres === 'caido') {
      throw new ServiceUnavailableException(
        'La base de datos PostgreSQL no está disponible',
      );
    }

    // Verifica el estado de Redis
    const redisActivo = await this.redis.ping();
    const estadoGeneral = redisActivo ? 'ok' : 'degradado';
    return {
      estado: 'ok',
      status: estadoGeneral,
      module: 'M8 - Notificaciones, Documentos y Soporte',
      modulo: 'M8 - Notificaciones, Documentos y Soporte',
      group: 'Grupo 10',
      dependencias: {
        postgres: estadoPostgres,
        redis: redisActivo ? 'activo' : 'caido (usando memoria de respaldo)',
      }, // Agrega un timestamp y el tiempo de actividad del proceso
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
