import { Controller, Get } from '@nestjs/common';
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
  async check() { 
    let estadoPostgres = 'caido';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      estadoPostgres = 'activo';
    } catch {
      estadoPostgres = 'caido';
    } // Verifica el estado de Redis
    const redisActivo = await this.redis.ping();
    return {
      status: estadoPostgres === 'activo' && redisActivo ? 'ok' : 'degradado',
      module: 'M8 - Notificaciones, Documentos y Soporte',
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
