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

  @Get('tickets/:ticketId')
  @ApiOperation({ summary: 'Obtener detalle de un ticket de soporte por UUID o ticketNumber (RF-8.7)' })
  @ApiResponse({ status: 200, description: 'Ticket encontrado' })
  @ApiResponse({ status: 404, description: 'Ticket no encontrado' })
  async getTicket(@Param('ticketId') ticketId: string) {
    return this.supportService.findOne(ticketId);
  }

  @Patch('tickets/:ticketId/status')
  @ApiOperation({ summary: 'Actualizar el estado de resolución de un ticket (RF-8.7)' })
  @ApiResponse({ status: 200, description: 'Estado actualizado' })
  @ApiResponse({ status: 400, description: 'Transición de estado inválida o ticket CLOSED' })
  @ApiResponse({ status: 404, description: 'Ticket no encontrado' })
  async updateStatus(@Param('ticketId') ticketId: string, @Body() dto: UpdateTicketStatusDto) {
    return this.supportService.updateStatus(ticketId, dto);
  }
}
