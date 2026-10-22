import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SupportService } from './support.service';
import { PrismaService } from '../../../common/prisma.service';
import {
  CreateTicketDto,
  TicketReferenceTypeDto,
  TicketStatusDto,
  UpdateTicketStatusDto,
} from './dto/support.dto';

describe('SupportService (RF-8.7)', () => {
  let service: SupportService;
  let mockPrisma: any;

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
    assignedTo: null,
    resolutionNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = {
      supportTicket: {
        create: jest.fn().mockResolvedValue(mockTicket),
        findMany: jest.fn().mockResolvedValue([mockTicket]),
        findFirst: jest.fn().mockResolvedValue(mockTicket),
        update: jest.fn().mockImplementation(async ({ where, data }) => ({
          ...mockTicket,
          ...data,
          id: where.id,
        })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportService,
        { provide: PrismaService, useValue: mockPrisma },
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

    it('debe crear un ticket con status OPEN y ticketNumber con formato TCK-2026-XXXXXX', async () => {
      const result = await service.create(dto);

      expect(result).toBeDefined();
      expect(mockPrisma.supportTicket.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          referenceId: 'trip-9082',
          referenceType: 'TRIP',
          subject: 'Problema con la tarifa debitada',
          status: 'OPEN',
          ticketNumber: expect.stringMatching(/^TCK-2026-[0-9A-F]{6}$/),
        }),
      });
    });

    it('debe reintentar la creación ante colisión de ticketNumber (error P2002)', async () => {
      mockPrisma.supportTicket.create
        .mockRejectedValueOnce({ code: 'P2002', message: 'Unique constraint violation' })
        .mockResolvedValueOnce(mockTicket);

      const result = await service.create(dto);

      expect(result).toBeDefined();
      expect(mockPrisma.supportTicket.create).toHaveBeenCalledTimes(2);
    });

    it('debe guardar en memoria de respaldo si Prisma arroja otro error', async () => {
      mockPrisma.supportTicket.create.mockRejectedValue(new Error('Connection failed'));

      const result = await service.create(dto);

      expect(result).toBeDefined();
      expect(result.id).toMatch(/^mem-/);
      expect(result.status).toBe(TicketStatusDto.OPEN);
      expect(result.ticketNumber).toMatch(/^TCK-2026-[0-9A-F]{6}$/);
    });
  });

  describe('findAll', () => {
    it('debe retornar la lista de tickets aplicando filtros si existen', async () => {
      const result = await service.findAll('trip-9082', 'OPEN');

      expect(result).toEqual([mockTicket]);
      expect(mockPrisma.supportTicket.findMany).toHaveBeenCalledWith({
        where: {
          referenceId: 'trip-9082',
          status: 'OPEN',
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('debe encontrar un ticket por UUID o ticketNumber', async () => {
      const result = await service.findOne('ticket-uuid-1');

      expect(result).toEqual(mockTicket);
      expect(mockPrisma.supportTicket.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ id: 'ticket-uuid-1' }, { ticketNumber: 'ticket-uuid-1' }],
        },
      });
    });

    it('debe lanzar NotFoundException si el ticket no existe', async () => {
      mockPrisma.supportTicket.findFirst.mockResolvedValue(null);

      await expect(service.findOne('inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    const updateDto: UpdateTicketStatusDto = {
      status: TicketStatusDto.RESOLVED,
      resolutionNote: 'Reintegro acreditado.',
    };

    it('debe actualizar el estado y la nota de resolución', async () => {
      const result = await service.updateStatus('ticket-uuid-1', updateDto);

      expect(result.status).toBe(TicketStatusDto.RESOLVED);
      expect(result.resolutionNote).toBe('Reintegro acreditado.');
      expect(mockPrisma.supportTicket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-uuid-1' },
        data: {
          status: 'RESOLVED',
          resolutionNote: 'Reintegro acreditado.',
        },
      });
    });

    it('debe rechazar con BadRequestException si el ticket actual ya está CLOSED', async () => {
      mockPrisma.supportTicket.findFirst.mockResolvedValue({
        ...mockTicket,
        status: TicketStatusDto.CLOSED,
      });

      await expect(service.updateStatus('ticket-uuid-1', updateDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.supportTicket.update).not.toHaveBeenCalled();
    });
  });
});
