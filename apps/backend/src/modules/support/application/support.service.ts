import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateTicketDto, UpdateTicketStatusDto } from './dto/support.dto';
import {
  SUPPORT_TICKET_REPOSITORY_PORT,
  SupportTicketRecord,
  SupportTicketReferenceType,
  SupportTicketRepositoryPort,
  SupportTicketStatus,
  TicketNumberCollisionError,
} from '../domain/ports/support-ticket.repository.port';
import * as crypto from 'crypto';

/**
 * Máquina de estados del ticket (RF-8.7):
 * OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED
 * CLOSED es estado final: no admite ninguna transición.
 */
const ALLOWED_TRANSITIONS: Record<SupportTicketStatus, SupportTicketStatus[]> = {
  OPEN: ['IN_PROGRESS'],
  IN_PROGRESS: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private readonly MAX_TICKET_NUMBER_ATTEMPTS = 3;

  constructor(
    @Inject(SUPPORT_TICKET_REPOSITORY_PORT)
    private readonly repository: SupportTicketRepositoryPort,
  ) {}

  /** Formato libre de colisiones al reiniciar el servicio: TCK-2026-XXXXXX */
  private generateTicketNumber(): string {
    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `TCK-2026-${randomHex}`;
  }

  async create(dto: CreateTicketDto): Promise<SupportTicketRecord> {
    for (let attempt = 1; attempt <= this.MAX_TICKET_NUMBER_ATTEMPTS; attempt++) {
      const ticketNumber = this.generateTicketNumber();

      try {
        const ticket = await this.repository.create({
          ticketNumber,
          referenceId: dto.referenceId,
          referenceType: dto.referenceType as SupportTicketReferenceType,
          subject: dto.subject,
          description: dto.description,
          createdBy: dto.createdBy,
        });
        this.logger.log(
          `Ticket creado exitosamente: ${ticketNumber} para ${dto.referenceType} ${dto.referenceId}`,
        );
        return ticket;
      } catch (error) {
        if (
          error instanceof TicketNumberCollisionError &&
          attempt < this.MAX_TICKET_NUMBER_ATTEMPTS
        ) {
          this.logger.warn(
            `Colisión de ticketNumber (${ticketNumber}). Reintentando intento ${attempt + 1}/${this.MAX_TICKET_NUMBER_ATTEMPTS}...`,
          );
          continue;
        }
        throw error;
      }
    }

    throw new Error(
      `No se pudo generar un ticketNumber único tras ${this.MAX_TICKET_NUMBER_ATTEMPTS} intentos.`,
    );
  }

  async findAll(referenceId?: string, status?: string): Promise<SupportTicketRecord[]> {
    return this.repository.findAll({
      referenceId,
      status: status as SupportTicketStatus | undefined,
    });
  }

  async findOne(id: string): Promise<SupportTicketRecord> {
    const ticket = await this.repository.findByIdOrNumber(id);
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    return ticket;
  }

  async updateStatus(id: string, dto: UpdateTicketStatusDto): Promise<SupportTicketRecord> {
    const existing = await this.findOne(id);
    const target = dto.status as SupportTicketStatus;

    if (existing.status === 'CLOSED') {
      throw new BadRequestException('Un ticket en estado CLOSED no puede ser modificado.');
    }

    if (!ALLOWED_TRANSITIONS[existing.status].includes(target)) {
      throw new BadRequestException(
        `Transición de estado inválida: ${existing.status} -> ${target}. ` +
          `Desde ${existing.status} solo se permite pasar a: ${ALLOWED_TRANSITIONS[existing.status].join(', ')}.`,
      );
    }

    return this.repository.updateStatus(existing.id, {
      status: target,
      resolutionNote: dto.resolutionNote,
    });
  }
}
