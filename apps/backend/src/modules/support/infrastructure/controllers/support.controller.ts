import { Controller, Post, Get, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { SupportService } from '../../application/support.service';
import { CreateTicketDto, UpdateTicketStatusDto } from '../../application/dto/support.dto';

@ApiTags('Soporte y Tickets')
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) { }

  @Post('tickets')
  @ApiOperation({ summary: 'Crear ticket de reclamo o consulta asociado a viaje, reserva o pago (RF-8.7)' })
  @ApiResponse({ status: 201, description: 'Ticket creado exitosamente' })
  async createTicket(@Body() dto: CreateTicketDto) {
    return this.supportService.create(dto);
  }

  @Get('tickets')
  @ApiOperation({ summary: 'Listar tickets de soporte con filtros opcionales (RF-8.7)' })
  @ApiQuery({ name: 'referenceId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] })
  async listTickets(@Query('referenceId') referenceId?: string, @Query('status') status?: string) {
    return this.supportService.findAll(referenceId, status);
  }

  @Get('tickets/:id')
  @ApiOperation({ summary: 'Obtener detalle de un ticket de soporte (RF-8.7)' })
  async getTicket(@Param('id') id: string) {
    return this.supportService.findOne(id);
  }

  @Patch('tickets/:id/status')
  @ApiOperation({ summary: 'Actualizar el estado de resolución de un ticket (RF-8.7)' })
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateTicketStatusDto) {
    return this.supportService.updateStatus(id, dto);
  }
}
