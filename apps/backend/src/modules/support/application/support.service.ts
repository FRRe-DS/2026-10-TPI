import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  CreateTicketDto,
  UpdateTicketStatusDto,
  TicketStatusDto,
} from './dto/support.dto';
import { PrismaService } from '../../../common/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private memoryTickets: any[] = [];

  constructor(private readonly prisma: PrismaService) {}

  private generateTicketNumber(): string {
    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `TCK-2026-${randomHex}`;
  }

  async create(dto: CreateTicketDto) {
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      const ticketNumber = this.generateTicketNumber();

      try {
        const ticket = await this.prisma.supportTicket.create({
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
        this.logger.log(`Ticket creado exitosamente: ${ticketNumber} para ${dto.referenceType} ${dto.referenceId}`);
        return ticket;
      } catch (e: any) {
        if (e?.code === 'P2002' && attempts < maxAttempts) {
          this.logger.warn(`Colisión de ticketNumber (${ticketNumber}). Reintentando intento ${attempts + 1}/${maxAttempts}...`);
          continue;
        }

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
      const ticket = await this.prisma.supportTicket.findFirst({
        where: {
          OR: [{ id }, { ticketNumber: id }],
        },
      });
      if (!ticket) throw new NotFoundException('Ticket no encontrado');
      return ticket;
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      const ticket = this.memoryTickets.find((t) => t.id === id || t.ticketNumber === id);
      if (!ticket) throw new NotFoundException('Ticket no encontrado');
      return ticket;
    }
  }

  async updateStatus(id: string, dto: UpdateTicketStatusDto) {
    const existing = await this.findOne(id);

    if (existing.status === TicketStatusDto.CLOSED) {
      throw new BadRequestException('Un ticket en estado CLOSED no puede ser modificado.');
    }

    try {
      return await this.prisma.supportTicket.update({
        where: { id: existing.id },
        data: {
          status: dto.status as any,
          resolutionNote: dto.resolutionNote,
        },
      });
    } catch (e) {
      existing.status = dto.status;
      existing.resolutionNote = dto.resolutionNote;
      existing.updatedAt = new Date().toISOString();
      return existing;
    }
  }
}
