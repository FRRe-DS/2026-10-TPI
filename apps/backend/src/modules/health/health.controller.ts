import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Chequeo de salud del servicio M8' })
  @ApiResponse({ status: 200, description: 'Servicio M8 operativo' })
  check() {
    return {
      status: 'ok',
      module: 'M8 - Notificaciones, Documentos y Soporte',
      group: 'Grupo 10',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
