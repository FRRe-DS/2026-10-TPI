import { Test, TestingModule } from '@nestjs/testing';
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
    referenceType: 'TRIP',
    subject: 'Problema con la tarifa debitada',
    description: 'El conductor cobró un recargo indebido.',
    status: 'OPEN',
    priority: 'MEDIUM',
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
});
