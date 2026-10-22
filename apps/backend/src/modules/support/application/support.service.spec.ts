import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SupportService } from './support.service';
import {
  SUPPORT_TICKET_REPOSITORY_PORT,
  SupportTicketRecord,
  SupportTicketRepositoryPort,
  SupportTicketStatus,
  TicketNumberCollisionError,
} from '../domain/ports/support-ticket.repository.port';
import {
  CreateTicketDto,
  TicketReferenceTypeDto,
  TicketStatusDto,
  UpdateTicketStatusDto,
} from './dto/support.dto';

describe('SupportService (RF-8.7)', () => {
  let service: SupportService;
  let repository: jest.Mocked<SupportTicketRepositoryPort>;

  const FIXED_DATE = new Date('2026-10-22T12:00:00.000Z');

  const buildTicket = (status: SupportTicketStatus = 'OPEN'): SupportTicketRecord => ({
    id: 'ticket-uuid-1',
    ticketNumber: 'TCK-2026-A1B2C3',
    referenceId: 'trip-9082',
    referenceType: 'TRIP',
    subject: 'Problema con la tarifa debitada',
    description: 'El conductor cobró un recargo indebido.',
    status,
    priority: 'MEDIUM',
    createdBy: 'usr-pass-456',
    assignedTo: null,
    resolutionNote: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  });

  beforeEach(async () => {
    repository = {
      create: jest.fn().mockResolvedValue(buildTicket()),
      findAll: jest.fn().mockResolvedValue([buildTicket()]),
      findByIdOrNumber: jest.fn().mockResolvedValue(buildTicket()),
      updateStatus: jest.fn().mockImplementation(async (id, data) => ({
        ...buildTicket(),
        id,
        status: data.status,
        resolutionNote: data.resolutionNote ?? null,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportService,
        { provide: SUPPORT_TICKET_REPOSITORY_PORT, useValue: repository },
      ],
    }).compile();

    service = module.get<SupportService>(SupportService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const dto: CreateTicketDto = {
      referenceId: 'trip-9082',
      referenceType: TicketReferenceTypeDto.TRIP,
      subject: 'Problema con la tarifa debitada',
      description: 'El conductor cobró un recargo indebido.',
      createdBy: 'usr-pass-456',
    };

    it('debe delegar en el puerto con ticketNumber con formato TCK-2026-XXXXXX', async () => {
      const result = await service.create(dto);

      expect(result).toEqual(buildTicket());
      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(repository.create).toHaveBeenCalledWith({
        ticketNumber: expect.stringMatching(/^TCK-2026-[0-9A-F]{6}$/),
        referenceId: 'trip-9082',
        referenceType: 'TRIP',
        subject: 'Problema con la tarifa debitada',
        description: 'El conductor cobró un recargo indebido.',
        createdBy: 'usr-pass-456',
      });
    });

    it('debe generar un ticketNumber distinto en cada creación (sin contador en memoria)', async () => {
      const numbers = new Set<string>();
      for (let i = 0; i < 20; i++) {
        await service.create(dto);
        numbers.add(repository.create.mock.calls[i][0].ticketNumber);
      }

      expect(numbers.size).toBeGreaterThan(1);
    });

    it('debe reintentar con otro ticketNumber ante TicketNumberCollisionError', async () => {
      repository.create
        .mockRejectedValueOnce(new TicketNumberCollisionError('TCK-2026-AAAAAA'))
        .mockResolvedValueOnce(buildTicket());

      const result = await service.create(dto);

      expect(result).toEqual(buildTicket());
      expect(repository.create).toHaveBeenCalledTimes(2);
    });

    it('debe fallar tras agotar los reintentos por colisión de ticketNumber', async () => {
      repository.create.mockRejectedValue(new TicketNumberCollisionError('TCK-2026-AAAAAA'));

      await expect(service.create(dto)).rejects.toThrow(TicketNumberCollisionError);
      expect(repository.create).toHaveBeenCalledTimes(3);
    });

    it('debe propagar sin reintentar cualquier otro error del puerto', async () => {
      repository.create.mockRejectedValue(new Error('Connection failed'));

      await expect(service.create(dto)).rejects.toThrow('Connection failed');
      expect(repository.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('findAll', () => {
    it('debe retornar la lista de tickets aplicando los filtros referenceId y status', async () => {
      const result = await service.findAll('trip-9082', 'OPEN');

      expect(result).toEqual([buildTicket()]);
      expect(repository.findAll).toHaveBeenCalledWith({
        referenceId: 'trip-9082',
        status: 'OPEN',
      });
    });

    it('debe consultar sin filtros cuando no se envían', async () => {
      await service.findAll();

      expect(repository.findAll).toHaveBeenCalledWith({
        referenceId: undefined,
        status: undefined,
      });
    });
  });

  describe('findOne', () => {
    it('debe encontrar un ticket por UUID o ticketNumber', async () => {
      const result = await service.findOne('ticket-uuid-1');

      expect(result).toEqual(buildTicket());
      expect(repository.findByIdOrNumber).toHaveBeenCalledWith('ticket-uuid-1');
    });

    it('debe lanzar NotFoundException si el ticket no existe', async () => {
      repository.findByIdOrNumber.mockResolvedValue(null);

      await expect(service.findOne('inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus - máquina de estados', () => {
    const dtoFor = (status: TicketStatusDto): UpdateTicketStatusDto => ({
      status,
      resolutionNote: 'Nota de resolución',
    });

    const validTransitions: Array<[SupportTicketStatus, TicketStatusDto]> = [
      ['OPEN', TicketStatusDto.IN_PROGRESS],
      ['IN_PROGRESS', TicketStatusDto.RESOLVED],
      ['RESOLVED', TicketStatusDto.CLOSED],
    ];

    it.each(validTransitions)(
      'debe permitir la transición válida %s -> %s',
      async (current, next) => {
        repository.findByIdOrNumber.mockResolvedValue(buildTicket(current));

        const result = await service.updateStatus('ticket-uuid-1', dtoFor(next));

        expect(result.status).toBe(next);
        expect(repository.updateStatus).toHaveBeenCalledWith('ticket-uuid-1', {
          status: next,
          resolutionNote: 'Nota de resolución',
        });
      },
    );

    const invalidTransitions: Array<[SupportTicketStatus, TicketStatusDto]> = [
      ['OPEN', TicketStatusDto.RESOLVED],
      ['OPEN', TicketStatusDto.CLOSED],
      ['OPEN', TicketStatusDto.OPEN],
      ['IN_PROGRESS', TicketStatusDto.OPEN],
      ['IN_PROGRESS', TicketStatusDto.CLOSED],
      ['RESOLVED', TicketStatusDto.OPEN],
      ['RESOLVED', TicketStatusDto.IN_PROGRESS],
    ];

    it.each(invalidTransitions)(
      'debe rechazar con BadRequestException la transición inválida %s -> %s',
      async (current, next) => {
        repository.findByIdOrNumber.mockResolvedValue(buildTicket(current));

        await expect(service.updateStatus('ticket-uuid-1', dtoFor(next))).rejects.toThrow(
          BadRequestException,
        );
        expect(repository.updateStatus).not.toHaveBeenCalled();
      },
    );

    it.each(Object.values(TicketStatusDto))(
      'debe impedir reabrir o modificar un ticket CLOSED (CLOSED -> %s)',
      async (next) => {
        repository.findByIdOrNumber.mockResolvedValue(buildTicket('CLOSED'));

        await expect(service.updateStatus('ticket-uuid-1', dtoFor(next))).rejects.toThrow(
          BadRequestException,
        );
        expect(repository.updateStatus).not.toHaveBeenCalled();
      },
    );

    it('debe lanzar NotFoundException si el ticket a actualizar no existe', async () => {
      repository.findByIdOrNumber.mockResolvedValue(null);

      await expect(
        service.updateStatus('inexistente', dtoFor(TicketStatusDto.IN_PROGRESS)),
      ).rejects.toThrow(NotFoundException);
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it('debe actualizar usando el UUID real aunque se identifique por ticketNumber', async () => {
      repository.findByIdOrNumber.mockResolvedValue(buildTicket('OPEN'));

      await service.updateStatus('TCK-2026-A1B2C3', dtoFor(TicketStatusDto.IN_PROGRESS));

      expect(repository.updateStatus).toHaveBeenCalledWith('ticket-uuid-1', expect.anything());
    });
  });
});
