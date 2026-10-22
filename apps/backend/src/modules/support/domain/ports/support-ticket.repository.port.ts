/**
 * Puerto de salida: Repositorio de Tickets de Soporte
 * Dominio puro – sin dependencias de NestJS, Prisma ni librerías de terceros (RF-8.7)
 */

export type SupportTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export type SupportTicketReferenceType = 'TRIP' | 'RESERVATION' | 'PAYMENT' | 'OTHER';

export type SupportTicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface SupportTicketRecord {
  id: string;
  ticketNumber: string;
  referenceId: string;
  referenceType: SupportTicketReferenceType;
  subject: string;
  description: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  createdBy: string;
  assignedTo: string | null;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSupportTicketData {
  ticketNumber: string;
  referenceId: string;
  referenceType: SupportTicketReferenceType;
  subject: string;
  description: string;
  createdBy: string;
}

export interface UpdateSupportTicketStatusData {
  status: SupportTicketStatus;
  resolutionNote?: string;
}

export interface SupportTicketFilters {
  referenceId?: string;
  status?: SupportTicketStatus;
}

/**
 * Error de dominio: el ticketNumber generado ya existe (clave única).
 * El adaptador de persistencia traduce el error técnico de la base de datos
 * a este error, para que la capa de aplicación pueda reintentar sin conocer
 * el motor de persistencia.
 */
export class TicketNumberCollisionError extends Error {
  constructor(public readonly ticketNumber: string) {
    super(`Colisión de ticketNumber: ${ticketNumber}`);
    this.name = 'TicketNumberCollisionError';
  }
}

export interface SupportTicketRepositoryPort {
  /**
   * Persiste un ticket nuevo.
   * @throws TicketNumberCollisionError si el ticketNumber ya existe.
   */
  create(data: CreateSupportTicketData): Promise<SupportTicketRecord>;

  /** Lista tickets (más recientes primero), con filtros opcionales. */
  findAll(filters?: SupportTicketFilters): Promise<SupportTicketRecord[]>;

  /** Busca por UUID o por ticketNumber. Devuelve null si no existe. */
  findByIdOrNumber(idOrNumber: string): Promise<SupportTicketRecord | null>;

  /** Actualiza estado y nota de resolución del ticket identificado por su UUID. */
  updateStatus(id: string, data: UpdateSupportTicketStatusData): Promise<SupportTicketRecord>;
}

export const SUPPORT_TICKET_REPOSITORY_PORT = Symbol('SUPPORT_TICKET_REPOSITORY_PORT');
