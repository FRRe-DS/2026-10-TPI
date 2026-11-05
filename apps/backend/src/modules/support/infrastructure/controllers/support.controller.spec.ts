import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportService } from '../../application/support.service';
import {
  CreateTicketDto,
  TicketReferenceTypeDto,
  TicketStatusDto,
  UpdateTicketStatusDto,
} from '../../application/dto/support.dto';

describe('SupportController (RF-8.7)', () => {
  let controller: SupportController;
  let service: jest.Mocked<Partial<SupportService>>;

  const mockTicket = {
    id: 'ticket-uuid-1',
    ticketNumber: 'TCK-2026-A1B2C3',
    referenceId: 'trip-9082',
    referenceType: 'TRIP' as const,
    subject: 'Problema con la tarifa debitada',
    description: 'El conductor cobró un recargo indebido.',
    status: 'OPEN' as const,
    priority: 'MEDIUM' as const,
    createdBy: 'usr-pass-456',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue(mockTicket),
      findAll: jest.fn().mockResolvedValue([mockTicket]),
      findOne: jest.fn().mockResolvedValue(mockTicket),
      updateStatus: jest.fn().mockResolvedValue({
        ...mockTicket,
        status: TicketStatusDto.RESOLVED,
      }),
      reopenResolvedTicket: jest.fn().mockResolvedValue({
        ...mockTicket,
        status: TicketStatusDto.IN_PROGRESS,
        resolutionNote: 'Reabierto por el usuario',
      }),
      appendHistory: jest.fn().mockResolvedValue({
        id: 'hist-1',
        ticketId: 'ticket-uuid-1',
        estadoAnterior: 'ABIERTO',
        estadoNuevo: 'EN_REVISION',
        autorId: 'usr-op-1',
        rolAutor: 'OPERADOR',
        motivo: 'En análisis',
        fecha: new Date().toISOString(),
      }),
      getHistory: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SupportController],
      providers: [
        { provide: SupportService, useValue: service },
      ],
    }).compile();

    controller = module.get<SupportController>(SupportController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('POST /support/tickets debe invocar service.create y retornar el ticket creado', async () => {
    const dto: CreateTicketDto = {
      referenceId: 'trip-9082',
      referenceType: TicketReferenceTypeDto.TRIP,
      subject: 'Problema con la tarifa debitada',
      description: 'El conductor cobró un recargo indebido.',
      createdBy: 'usr-pass-456',
    };

    const result = await controller.createTicket(dto);

    expect(result).toEqual(mockTicket);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('GET /support/tickets debe invocar service.findAll con los filtros query', async () => {
    const result = await controller.listTickets('trip-9082', 'OPEN');

    expect(result).toEqual([mockTicket]);
    expect(service.findAll).toHaveBeenCalledWith('trip-9082', 'OPEN');
  });

  it('GET /support/tickets/:id debe invocar service.findOne con el identificador', async () => {
    const result = await controller.getTicket('ticket-uuid-1');

    expect(result).toEqual(mockTicket);
    expect(service.findOne).toHaveBeenCalledWith('ticket-uuid-1');
  });

  it('PATCH /support/tickets/:id/status debe invocar service.updateStatus con el body', async () => {
    const updateDto: UpdateTicketStatusDto = {
      status: TicketStatusDto.RESOLVED,
      resolutionNote: 'Reintegro emitido',
    };

    const result = await controller.updateStatus('ticket-uuid-1', updateDto);

    expect(result.status).toBe(TicketStatusDto.RESOLVED);
    expect(service.updateStatus).toHaveBeenCalledWith('ticket-uuid-1', updateDto);
  });

  describe('Rutas Canónicas del Contrato Coordinado Definitivo (G10 + G7)', () => {
    it('POST /tickets (crearTicketUnificado) debe priorizar el sub del JWT Bearer cuando está presente', async () => {
      const payloadBase64 = Buffer.from(
        JSON.stringify({ sub: 'usr-jwt-999', rol: 'CLIENTE' }),
      ).toString('base64url');
      const fakeJwt = `Bearer eyJhbGciOiJIUzI1NiJ9.${payloadBase64}.sig`;

      const res = await controller.crearTicketUnificado(
        {
          referencia: { tipo: 'VIAJE', id: 'trip-9082' },
          titulo: 'Problema con la tarifa debitada',
          descripcion: 'El conductor cobró un recargo indebido.',
          usuarioId: 'usr-body-ignorado',
        },
        fakeJwt,
      );

      expect(service.create).toHaveBeenCalledWith(
        expect.objectContaining({
          referenceId: 'trip-9082',
          referenceType: TicketReferenceTypeDto.TRIP,
          createdBy: 'usr-jwt-999',
        }),
      );
      expect(res.estado).toBe('ABIERTO');
      expect(res.codigoTicket).toBe('TCK-2026-A1B2C3');
    });

    it('PATCH /tickets/:ticketId (cambiarEstadoTicketUnificado) debe mapear estados en español y exigir resolucion al pasar a RESUELTO', async () => {
      await expect(
        controller.cambiarEstadoTicketUnificado('ticket-uuid-1', {
          estado: 'RESUELTO',
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      const res = await controller.cambiarEstadoTicketUnificado('ticket-uuid-1', {
        estado: 'RESUELTO',
        resolucion: 'Reintegro acreditado',
      });

      expect(service.updateStatus).toHaveBeenCalledWith('ticket-uuid-1', {
        status: TicketStatusDto.RESOLVED,
        resolutionNote: 'Reintegro acreditado',
      });
      expect(res.estado).toBe('RESUELTO');
    });

    it('PATCH /tickets/:ticketId debe permitir reabrir un ticket RESUELTO pasando a EN_REVISION y persistir el historial', async () => {
      (service.findOne as jest.Mock).mockResolvedValueOnce({
        ...mockTicket,
        status: 'RESOLVED',
      });

      const res = await controller.cambiarEstadoTicketUnificado('ticket-uuid-1', {
        estado: 'EN_REVISION',
        motivo: 'El usuario adjuntó nueva evidencia',
      });

      expect(service.reopenResolvedTicket).toHaveBeenCalledWith(
        'ticket-uuid-1',
        'El usuario adjuntó nueva evidencia',
      );
      expect(res.estado).toBe('EN_REVISION');
      expect(service.appendHistory).toHaveBeenCalled();
    });

    it('debe validar RBAC y ownership sobre JWT Bearer (401 token malformado, 403 acceso a ticket ajeno)', async () => {
      await expect(
        controller.obtenerTicketUnificado('ticket-uuid-1', 'Bearer token-invalido'),
      ).rejects.toThrow(UnauthorizedException);

      const otroClientePayload = Buffer.from(
        JSON.stringify({ sub: 'usr-otro-999', rol: 'CLIENTE' }),
      ).toString('base64url');
      const otroClienteJwt = `Bearer eyJhbGciOiJIUzI1NiJ9.${otroClientePayload}.sig`;

      await expect(
        controller.obtenerTicketUnificado('ticket-uuid-1', otroClienteJwt),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
