import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateTicketDto, UpdateTicketStatusDto, TicketStatusDto } from './dto/support.dto';
import { PrismaService } from '../../../common/prisma.service';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private memoryTickets: any[] = [];
  private ticketCounter = 1000;

  constructor(private readonly prisma: PrismaService) { }

  async create(dto: CreateTicketDto) {
    this.ticketCounter++;
    const ticketNumber = `TCK-${this.ticketCounter}`;

    try {
      return await this.prisma.supportTicket.create({
        data: {
          ticketNumber,
          referenceId: dto.referenceId,
          referenceType: dto.referenceType as any,
          subject: dto.subject,
          description: dto.description,
          createdBy: dto.createdBy,
          status: 'OPEN',
        },
      });
    } catch (e) {
      this.logger.warn(`⚠ Prisma no conectado, guardando en memoria: ${e.message}`);
      const ticket = {
        id: 'mem-' + Date.now(),
        ticketNumber,
        referenceId: dto.referenceId,
        referenceType: dto.referenceType,
        subject: dto.subject,
        description: dto.description,
        createdBy: dto.createdBy,
        status: TicketStatusDto.OPEN,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.memoryTickets.unshift(ticket);
      return ticket;
    }
  }

  async findAll(referenceId?: string, status?: string) {
    try {
      return await this.prisma.supportTicket.findMany({
        where: {
          referenceId: referenceId ? referenceId : undefined,
          status: status ? (status as any) : undefined,
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (e) {
      return this.memoryTickets.filter((t) => {
        if (referenceId && t.referenceId !== referenceId) return false;
        if (status && t.status !== status) return false;
        return true;
      });
    }
  }

  async findOne(id: string) {
    try {
      const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
      if (!ticket) throw new NotFoundException('Ticket no encontrado');
      return ticket;
    } catch (e) {
      const ticket = this.memoryTickets.find((t) => t.id === id || t.ticketNumber === id);
      if (!ticket) throw new NotFoundException('Ticket no encontrado');
      return ticket;
    }
  }

  async updateStatus(id: string, dto: UpdateTicketStatusDto) {
    try {
      return await this.prisma.supportTicket.update({
        where: { id },
        data: {
          status: dto.status as any,
          resolutionNote: dto.resolutionNote,
        },
      });
    } catch (e) {
      const ticket = this.memoryTickets.find((t) => t.id === id || t.ticketNumber === id);
      if (!ticket) throw new NotFoundException('Ticket no encontrado');
      ticket.status = dto.status;
      ticket.resolutionNote = dto.resolutionNote;
      ticket.updatedAt = new Date().toISOString();
      return ticket;
    }
  }
}
