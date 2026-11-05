import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  Res,
  Optional,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { Response } from 'express';
import * as crypto from 'crypto';
import { SupportService } from '../../application/support.service';
import {
  CambiarEstadoTicketUnificadoDto,
  CrearTicketUnificadoDto,
  CreateTicketDto,
  TicketReferenceTypeDto,
  TicketStatusDto,
  UpdateTicketStatusDto,
} from '../../application/dto/support.dto';
import {
  SupportTicketHistoryEntry,
  SupportTicketRecord,
} from '../../domain/ports/support-ticket.repository.port';
import { RedisService } from '../../../../common/redis.service';
import {
  assertResourceOwnership,
  checkIdempotency,
  parseAndAuthorizeJwt,
  saveIdempotency,
} from '../../../../common/contract-security.util';

const STATUS_FROM_SPANISH: Record<string, TicketStatusDto> = {
  ABIERTO: TicketStatusDto.OPEN,
  OPEN: TicketStatusDto.OPEN,
  EN_REVISION: TicketStatusDto.IN_PROGRESS,
  EN_CURSO: TicketStatusDto.IN_PROGRESS,
  IN_PROGRESS: TicketStatusDto.IN_PROGRESS,
  RESUELTO: TicketStatusDto.RESOLVED,
  RESOLVED: TicketStatusDto.RESOLVED,
  CERRADO: TicketStatusDto.CLOSED,
  CLOSED: TicketStatusDto.CLOSED,
};

const STATUS_TO_SPANISH: Record<string, string> = {
  OPEN: 'ABIERTO',
  IN_PROGRESS: 'EN_REVISION',
  RESOLVED: 'RESUELTO',
  CLOSED: 'CERRADO',
};

const REF_FROM_SPANISH: Record<string, TicketReferenceTypeDto> = {
  VIAJE: TicketReferenceTypeDto.TRIP,
  TRIP: TicketReferenceTypeDto.TRIP,
  RESERVA: TicketReferenceTypeDto.RESERVATION,
  RESERVATION: TicketReferenceTypeDto.RESERVATION,
  PAGO: TicketReferenceTypeDto.PAYMENT,
  PAYMENT: TicketReferenceTypeDto.PAYMENT,
  OTRO: TicketReferenceTypeDto.OTHER,
  OTHER: TicketReferenceTypeDto.OTHER,
};

const REF_TO_SPANISH: Record<string, string> = {
  TRIP: 'VIAJE',
  RESERVATION: 'RESERVA',
  PAYMENT: 'PAGO',
  OTHER: 'OTRO',
};

const PRIORITY_TO_SPANISH: Record<string, string> = {
  LOW: 'BAJA',
  MEDIUM: 'MEDIA',
  HIGH: 'ALTA',
  URGENT: 'URGENTE',
};

@ApiTags('Soporte y Tickets')
@Controller()
export class SupportController {
  private readonly idempotencyStore = new Map<string, { hash: string; response: any }>();
  private readonly memoryHistory = new Map<string, SupportTicketHistoryEntry[]>();

  constructor(
    private readonly supportService: SupportService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  // ─── Rutas Originales G10 (Retrocompatibilidad Frontend y Tests) ────────────

  @Post('support/tickets')
  @ApiOperation({ summary: 'Crear ticket de reclamo o consulta asociado a viaje, reserva o pago (RF-8.7)' })
  @ApiResponse({ status: 201, description: 'Ticket creado exitosamente' })
  async createTicket(@Body() dto: CreateTicketDto) {
    return this.supportService.create(dto);
  }

  @Get('support/tickets')
  @ApiOperation({ summary: 'Listar tickets de soporte con filtros opcionales (RF-8.7)' })
  @ApiQuery({ name: 'referenceId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] })
  async listTickets(@Query('referenceId') referenceId?: string, @Query('status') status?: string) {
    return this.supportService.findAll(referenceId, status);
  }

  @Get('support/tickets/:ticketId')
  @ApiOperation({ summary: 'Obtener detalle de un ticket de soporte por UUID o ticketNumber (RF-8.7)' })
  @ApiResponse({ status: 200, description: 'Ticket encontrado' })
  @ApiResponse({ status: 404, description: 'Ticket no encontrado' })
  async getTicket(@Param('ticketId') ticketId: string) {
    return this.supportService.findOne(ticketId);
  }

  @Patch('support/tickets/:ticketId/status')
  @ApiOperation({ summary: 'Actualizar el estado de resolución de un ticket (RF-8.7)' })
  @ApiResponse({ status: 200, description: 'Estado actualizado' })
  @ApiResponse({ status: 400, description: 'Transición de estado inválida o ticket CLOSED' })
  @ApiResponse({ status: 404, description: 'Ticket no encontrado' })
  async updateStatus(@Param('ticketId') ticketId: string, @Body() dto: UpdateTicketStatusDto) {
    return this.supportService.updateStatus(ticketId, dto);
  }

  // ─── Rutas Canónicas del Contrato Coordinado Definitivo (G10 + G7) ──────────

  @Post('tickets')
  @ApiOperation({
    summary: 'Crear un ticket de soporte (RF-8.7 - Contrato Coordinado)',
  })
  @ApiResponse({ status: 201, description: 'Ticket creado' })
  @ApiResponse({ status: 400, description: 'Solicitud inválida' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Sin permiso' })
  @ApiResponse({ status: 422, description: 'Conflicto de idempotencia' })
  async crearTicketUnificado(
    @Body() dto: CrearTicketUnificadoDto,
    @Headers('authorization') authHeader?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const jwtIdentity = parseAndAuthorizeJwt(authHeader, ['CLIENTE', 'CONDUCTOR']);
    const createdBy =
      jwtIdentity.sub ?? dto.usuarioId ?? dto.createdBy ?? 'usr-anonimo';
    const rol = jwtIdentity.rol ?? 'CLIENTE';

    const referenceId = dto.referencia?.id ?? dto.referenceId ?? '';
    const rawRefType = dto.referencia?.tipo ?? dto.referenceType ?? 'VIAJE';
    const referenceType =
      REF_FROM_SPANISH[rawRefType.toUpperCase()] ?? TicketReferenceTypeDto.TRIP;
    const subject = dto.titulo ?? dto.subject ?? '';
    const description = dto.descripcion ?? dto.description ?? '';

    if (!referenceId.trim() || !subject.trim() || !description.trim()) {
      throw new BadRequestException(
        'Los campos referencia.id (o referenceId), titulo (o subject) y descripcion (o description) son obligatorios.',
      );
    }

    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ referenceId, referenceType, subject, description, createdBy }))
      .digest('hex');

    const cached = await checkIdempotency(
      this.idempotencyStore,
      this.redis,
      'ticket',
      idempotencyKey,
      hash,
    );
    if (cached) {
      if (res && typeof res.setHeader === 'function' && cached.ticketId) {
        res.setHeader('Location', `/api/v1/tickets/${encodeURIComponent(cached.ticketId)}`);
      }
      return cached;
    }

    const record = await this.supportService.create({
      referenceId,
      referenceType,
      subject,
      description,
      createdBy,
    });

    const response = this.toUnifiedTicket(record, rol);
    if (res && typeof res.setHeader === 'function') {
      res.setHeader('Location', `/api/v1/tickets/${encodeURIComponent(record.id)}`);
    }
    await saveIdempotency(this.idempotencyStore, this.redis, 'ticket', idempotencyKey, hash, response);
    return response;
  }

  @Get('tickets')
  @ApiOperation({
    summary: 'Listar tickets de soporte paginados (RF-8.7 - Contrato Coordinado)',
  })
  @ApiQuery({ name: 'referenciaId', required: false })
  @ApiQuery({ name: 'referenceId', required: false })
  @ApiQuery({ name: 'referenciaTipo', required: false, enum: ['VIAJE', 'RESERVA', 'PAGO'] })
  @ApiQuery({ name: 'usuarioId', required: false })
  @ApiQuery({
    name: 'estado',
    required: false,
    enum: ['ABIERTO', 'EN_REVISION', 'RESUELTO', 'CERRADO', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'size', required: false })
  async listarTicketsUnificado(
    @Query('referenciaId') referenciaId?: string,
    @Query('referenceId') referenceId?: string,
    @Query('estado') estado?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('referenciaTipo') referenciaTipo?: string,
    @Query('usuarioId') usuarioId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwtIdentity = parseAndAuthorizeJwt(authHeader, ['CLIENTE', 'CONDUCTOR', 'OPERADOR']);
    const pageNum = Math.max(0, Number(page ?? 0) || 0);
    const sizeNum = Math.min(100, Math.max(1, Number(size ?? 20) || 20));
    const rawStatus = estado ?? status;
    const mappedStatus = rawStatus
      ? (STATUS_FROM_SPANISH[rawStatus.toUpperCase()] ?? rawStatus)
      : undefined;

    let records = await this.supportService.findAll(
      referenciaId ?? referenceId,
      mappedStatus,
    );

    if (referenciaTipo) {
      const targetRef = REF_FROM_SPANISH[referenciaTipo.toUpperCase()];
      if (targetRef) {
        records = records.filter((r) => r.referenceType === targetRef);
      }
    }

    // Si es CLIENTE o CONDUCTOR autenticado, solo ve los suyos; si es OPERADOR, puede filtrar por usuarioId
    const effectiveUserFilter =
      jwtIdentity.authenticated &&
      jwtIdentity.rol &&
      ['CLIENTE', 'CONDUCTOR'].includes(jwtIdentity.rol) &&
      jwtIdentity.sub
        ? jwtIdentity.sub
        : usuarioId;

    if (effectiveUserFilter) {
      records = records.filter((r) => r.createdBy === effectiveUserFilter);
    }

    const totalElementos = records.length;
    const totalPaginas = Math.max(1, Math.ceil(totalElementos / sizeNum));
    const slice = records.slice(pageNum * sizeNum, pageNum * sizeNum + sizeNum);
    const mapped = slice.map((r) => this.toUnifiedTicket(r));

    return {
      page: pageNum,
      size: sizeNum,
      totalElementos,
      totalPaginas,
      items: mapped,
      elementos: mapped,
    };
  }

  @Get('tickets/:ticketId')
  @ApiOperation({
    summary: 'Consultar un ticket (RF-8.7 - Contrato Coordinado)',
  })
  @ApiParam({ name: 'ticketId', description: 'UUID o código TCK-2026-XXXXXX' })
  @ApiResponse({ status: 200, description: 'Ticket' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  async obtenerTicketUnificado(
    @Param('ticketId') ticketId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwtIdentity = parseAndAuthorizeJwt(authHeader, ['CLIENTE', 'CONDUCTOR', 'OPERADOR']);
    const record = await this.supportService.findOne(ticketId);
    assertResourceOwnership(jwtIdentity, record.createdBy, ['CLIENTE', 'CONDUCTOR']);
    return this.toUnifiedTicket(record);
  }

  @Patch(['tickets/:ticketId', 'tickets/:ticketId/status'])
  @ApiOperation({
    summary: 'Cambiar el estado de un ticket (RF-8.7 - Contrato Coordinado)',
  })
  @ApiParam({ name: 'ticketId', description: 'UUID o código TCK-2026-XXXXXX' })
  @ApiResponse({ status: 200, description: 'Ticket actualizado' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  @ApiResponse({ status: 409, description: 'Transición de estado inválida' })
  @ApiResponse({ status: 422, description: 'Falta resolución al pasar a RESUELTO' })
  async cambiarEstadoTicketUnificado(
    @Param('ticketId') ticketId: string,
    @Body() dto: CambiarEstadoTicketUnificadoDto,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwtIdentity = parseAndAuthorizeJwt(authHeader, ['OPERADOR']);
    const rawState = dto.estado ?? dto.status;
    if (!rawState) {
      throw new BadRequestException('El campo estado (o status) es obligatorio.');
    }

    const mappedStatus = STATUS_FROM_SPANISH[rawState.toUpperCase()];
    if (!mappedStatus) {
      throw new BadRequestException(`Estado de ticket inválido: ${rawState}`);
    }

    const resolutionNote = dto.resolucion ?? dto.resolutionNote ?? dto.motivo;

    // Contrato coordinado: Pasar a RESUELTO exige resolucion (si falta, 422)
    if (mappedStatus === TicketStatusDto.RESOLVED && dto.estado && !resolutionNote?.trim()) {
      throw new UnprocessableEntityException({
        type: '/errores/resolucion-requerida',
        title: 'La resolución es obligatoria al pasar a RESUELTO',
        detail: 'Debe especificar el campo "resolucion" para marcar el ticket como RESUELTO.',
      });
    }

    let previousStatusEsp = 'ABIERTO';
    if (this.supportService.findOne) {
      try {
        const before = await this.supportService.findOne(ticketId);
        if (before?.status) {
          previousStatusEsp = STATUS_TO_SPANISH[before.status] ?? before.status;
        }
      } catch {
        // Si no existe, updateStatus lanzará NotFoundException
      }
    }

    let updated: SupportTicketRecord;
    if (
      previousStatusEsp === 'RESUELTO' &&
      mappedStatus === TicketStatusDto.IN_PROGRESS &&
      typeof this.supportService.reopenResolvedTicket === 'function'
    ) {
      updated = await this.supportService.reopenResolvedTicket(ticketId, resolutionNote);
    } else {
      try {
        updated = await this.supportService.updateStatus(ticketId, {
          status: mappedStatus,
          resolutionNote,
        });
      } catch (error) {
        if (error instanceof BadRequestException) {
          if (
            mappedStatus === TicketStatusDto.IN_PROGRESS &&
            typeof this.supportService.reopenResolvedTicket === 'function'
          ) {
            try {
              updated = await this.supportService.reopenResolvedTicket(ticketId, resolutionNote);
            } catch {
              throw new ConflictException({
                type: '/errores/transicion-estado-invalida',
                title: 'Transición de estado inválida',
                detail: error.message,
              });
            }
          } else {
            throw new ConflictException({
              type: '/errores/transicion-estado-invalida',
              title: 'Transición de estado inválida',
              detail: error.message,
            });
          }
        } else {
          throw error;
        }
      }
    }

    const newStatusEsp = STATUS_TO_SPANISH[updated.status] ?? updated.status;
    const historyEntry: SupportTicketHistoryEntry = {
      estadoAnterior: previousStatusEsp,
      estadoNuevo: newStatusEsp,
      actorId: jwtIdentity.sub ?? updated.assignedTo ?? 'operador-m8',
      ...(dto.motivo || resolutionNote ? { motivo: dto.motivo ?? resolutionNote } : {}),
      cambiadoEn: (updated.updatedAt ?? new Date()).toISOString(),
    };

    const list = this.memoryHistory.get(updated.id) ?? [];
    list.push(historyEntry);
    this.memoryHistory.set(updated.id, list);
    if (typeof this.supportService.appendHistory === 'function') {
      await this.supportService.appendHistory(updated.id, historyEntry);
    }

    return this.toUnifiedTicket(updated);
  }

  @Get('tickets/:ticketId/historial')
  @ApiOperation({
    summary: 'Historial de estados de un ticket (RF-8.7 - Contrato Coordinado)',
  })
  @ApiParam({ name: 'ticketId', description: 'UUID o código TCK-2026-XXXXXX' })
  async listarHistorialTicket(
    @Param('ticketId') ticketId: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwtIdentity = parseAndAuthorizeJwt(authHeader, ['CLIENTE', 'CONDUCTOR', 'OPERADOR']);
    const pageNum = Math.max(0, Number(page ?? 0) || 0);
    const sizeNum = Math.min(100, Math.max(1, Number(size ?? 20) || 20));
    const record = await this.supportService.findOne(ticketId);
    assertResourceOwnership(jwtIdentity, record.createdBy, ['CLIENTE', 'CONDUCTOR']);

    let cambios: SupportTicketHistoryEntry[] = [];
    if (typeof this.supportService.getHistory === 'function') {
      cambios = await this.supportService.getHistory(record.id);
    }
    if (cambios.length === 0) {
      cambios = this.memoryHistory.get(record.id) ?? [];
    }

    if (cambios.length === 0) {
      const sequence: Array<{ from: string; to: string }> = [
        { from: 'ABIERTO', to: 'EN_REVISION' },
        { from: 'EN_REVISION', to: 'RESUELTO' },
        { from: 'RESUELTO', to: 'CERRADO' },
      ];
      const order = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
      const currentIdx = Math.max(0, order.indexOf(record.status));
      cambios = sequence.slice(0, currentIdx).map((step) => ({
        estadoAnterior: step.from,
        estadoNuevo: step.to,
        actorId: record.assignedTo ?? 'operador-m8',
        ...(record.resolutionNote ? { motivo: record.resolutionNote } : {}),
        cambiadoEn: record.updatedAt.toISOString(),
      }));
    }

    const totalElementos = cambios.length;
    const totalPaginas = Math.max(1, Math.ceil(totalElementos / sizeNum));
    const slice = cambios.slice(pageNum * sizeNum, pageNum * sizeNum + sizeNum);

    return {
      page: pageNum,
      size: sizeNum,
      totalElementos,
      totalPaginas,
      items: slice,
      elementos: slice,
    };
  }

  private toUnifiedTicket(record: SupportTicketRecord, rol = 'CLIENTE') {
    const createdIso = record.createdAt.toISOString();
    const updatedIso = record.updatedAt.toISOString();
    const estadoEsp = STATUS_TO_SPANISH[record.status] ?? record.status;
    const refTipoEsp = REF_TO_SPANISH[record.referenceType] ?? record.referenceType;

    return {
      ticketId: record.id,
      id: record.id,
      codigoTicket: record.ticketNumber,
      ticketNumber: record.ticketNumber,
      usuarioId: record.createdBy,
      createdBy: record.createdBy,
      rol,
      referencia: {
        tipo: refTipoEsp,
        id: record.referenceId,
      },
      referenceId: record.referenceId,
      referenceType: record.referenceType,
      titulo: record.subject,
      subject: record.subject,
      descripcion: record.description,
      description: record.description,
      estado: estadoEsp,
      status: record.status,
      prioridad: PRIORITY_TO_SPANISH[record.priority] ?? 'MEDIA',
      priority: record.priority,
      ...(record.resolutionNote
        ? { resolucion: record.resolutionNote, resolutionNote: record.resolutionNote }
        : {}),
      ...(record.assignedTo
        ? { asignadoA: record.assignedTo, assignedTo: record.assignedTo }
        : {}),
      creadoEn: createdIso,
      createdAt: createdIso,
      actualizadoEn: updatedIso,
      updatedAt: updatedIso,
      ...(record.status === 'CLOSED' ? { cerradoEn: updatedIso } : {}),
    };
  }
}
