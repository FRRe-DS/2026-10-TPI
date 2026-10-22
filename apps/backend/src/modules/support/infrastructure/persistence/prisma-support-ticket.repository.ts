import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/prisma.service';
import {
  CreateSupportTicketData,
  SupportTicketFilters,
  SupportTicketRecord,
  SupportTicketRepositoryPort,
  TicketNumberCollisionError,
  UpdateSupportTicketStatusData,
} from '../../domain/ports/support-ticket.repository.port';

/**
 * Adaptador de persistencia: implementa SupportTicketRepositoryPort con Prisma ORM
 * sobre la tabla SupportTicket de PostgreSQL/Supabase.
 *
 * Traduce el error técnico P2002 (violación de clave única) sobre ticketNumber
 * al error de dominio TicketNumberCollisionError.
 */
@Injectable()
export class PrismaSupportTicketRepository implements SupportTicketRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateSupportTicketData): Promise<SupportTicketRecord> {
    try {
      const created = await this.prisma.supportTicket.create({
        data: {
          ticketNumber: data.ticketNumber,
          referenceId: data.referenceId,
          referenceType: data.referenceType,
          subject: data.subject,
          description: data.description,
          createdBy: data.createdBy,
          status: 'OPEN',
        },
      });
      return this.toRecord(created);
    } catch (error) {
      if (this.isTicketNumberCollision(error)) {
        throw new TicketNumberCollisionError(data.ticketNumber);
      }
      throw error;
    }
  }

  async findAll(filters: SupportTicketFilters = {}): Promise<SupportTicketRecord[]> {
    const rows = await this.prisma.supportTicket.findMany({
      where: {
        referenceId: filters.referenceId ? filters.referenceId : undefined,
        status: filters.status ? filters.status : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toRecord(row));
  }

  async findByIdOrNumber(idOrNumber: string): Promise<SupportTicketRecord | null> {
    const row = await this.prisma.supportTicket.findFirst({
      where: {
        OR: [{ id: idOrNumber }, { ticketNumber: idOrNumber }],
      },
    });
    return row ? this.toRecord(row) : null;
  }

  async updateStatus(
    id: string,
    data: UpdateSupportTicketStatusData,
  ): Promise<SupportTicketRecord> {
    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        status: data.status,
        resolutionNote: data.resolutionNote,
      },
    });
    return this.toRecord(updated);
  }

  /**
   * Valida si el error P2002 de Prisma corresponde específicamente a ticketNumber.
   * Si Prisma no informa el campo (meta ausente) se asume colisión de ticketNumber,
   * que es la única restricción única además del id autogenerado.
   */
  private isTicketNumberCollision(error: unknown): boolean {
    const err = error as { code?: string; meta?: Record<string, unknown> } | null | undefined;
    if (err?.code !== 'P2002') {
      return false;
    }
    const target = err.meta?.['target'];
    if (Array.isArray(target)) {
      return target.some((field) => String(field).includes('ticketNumber'));
    }
    if (typeof target === 'string') {
      return target.includes('ticketNumber');
    }
    return true;
  }

  private toRecord(row: {
    id: string;
    ticketNumber: string;
    referenceId: string;
    referenceType: any;
    subject: string;
    description: string;
    status: any;
    priority: any;
    createdBy: string;
    assignedTo: string | null;
    resolutionNote: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): SupportTicketRecord {
    return {
      id: row.id,
      ticketNumber: row.ticketNumber,
      referenceId: row.referenceId,
      referenceType: row.referenceType,
      subject: row.subject,
      description: row.description,
      status: row.status,
      priority: row.priority,
      createdBy: row.createdBy,
      assignedTo: row.assignedTo,
      resolutionNote: row.resolutionNote,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
