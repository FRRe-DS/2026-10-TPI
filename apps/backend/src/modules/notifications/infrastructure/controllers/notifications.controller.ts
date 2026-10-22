import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { NotificationsService } from '../../application/notifications.service';
import {
  SendNotificationDto,
} from '../../application/dto/send-notification.dto';

@ApiTags('Notificaciones')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) { }

  @Post('send')
  @ApiOperation({ summary: 'Enviar una notificación inmediata (RF-8.1, RF-8.2)' })
  @ApiBody({ type: SendNotificationDto })
  @ApiResponse({
    status: 201,
    description: 'Intento registrado; status indica si el envío fue exitoso',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        id: { type: 'string', example: 'notification-uuid' },
        status: {
          type: 'string',
          enum: ['SENT', 'FAILED'],
          example: 'SENT',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Datos de la notificación inválidos' })
  @ApiResponse({
    status: 500,
    description: 'No se pudo registrar el intento de notificación',
  })
  async send(@Body() dto: SendNotificationDto) {
    return this.notificationsService.send(dto);
  }

  @Get('logs')
  @ApiOperation({ summary: 'Consultar el historial y estado de notificaciones enviadas (RF-8.6)' })
  @ApiQuery({ name: 'recipient', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'SENT', 'FAILED'] })
  async getLogs(@Query('recipient') recipient?: string, @Query('status') status?: string) {
    return this.notificationsService.getLogs(recipient, status);
  }
}
