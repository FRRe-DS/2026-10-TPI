import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { NotificationsService } from '../../application/notifications.service';
import { SendNotificationDto } from '../../application/dto/send-notification.dto';

@ApiTags('Notificaciones')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) { }

  @Post('send')
  @ApiOperation({ summary: 'Enviar una notificación inmediata (RF-8.1, RF-8.2)' })
  @ApiResponse({ status: 201, description: 'Notificación procesada y enviada' })
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
