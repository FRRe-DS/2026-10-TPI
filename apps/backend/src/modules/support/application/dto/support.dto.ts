import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export enum TicketReferenceTypeDto {
  TRIP = 'TRIP',
  RESERVATION = 'RESERVATION',
  PAYMENT = 'PAYMENT',
  OTHER = 'OTHER',
}

export enum TicketStatusDto {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export class CreateTicketDto {
  @ApiProperty({ example: 'trip-abc-123', description: 'ID de la entidad vinculada (viaje, reserva o pago)' })
  @IsString()
  @IsNotEmpty()
  referenceId: string;

  @ApiProperty({ enum: TicketReferenceTypeDto, default: TicketReferenceTypeDto.TRIP })
  @IsEnum(TicketReferenceTypeDto)
  referenceType: TicketReferenceTypeDto;

  @ApiProperty({ example: 'Problema con la tarifa debitada', description: 'Título del ticket' })
  @IsString()
  @MinLength(5)
  subject: string;

  @ApiProperty({ example: 'El conductor cobró un recargo no estipulado en la cotización.', description: 'Detalle' })
  @IsString()
  @MinLength(10)
  description: string;

  @ApiProperty({ example: 'usr-passenger-456', description: 'Identificador del usuario que abre el reclamo' })
  @IsString()
  @IsNotEmpty()
  createdBy: string;
}

export class UpdateTicketStatusDto {
  @ApiProperty({ enum: TicketStatusDto })
  @IsEnum(TicketStatusDto)
  status: TicketStatusDto;

  @ApiProperty({ required: false, example: 'Reintegro emitido exitosamente hacia la billetera del cliente.' })
  @IsString()
  @IsOptional()
  resolutionNote?: string;
}

// ─── DTOs para el Contrato Coordinado Definitivo (G10 + G7) ─────────────────

export class ReferenciaTicketDto {
  @ApiProperty({ example: 'VIAJE', enum: ['VIAJE', 'RESERVA', 'PAGO'] })
  @IsString()
  @IsOptional()
  tipo?: string;

  @ApiProperty({ example: 'trip-9082' })
  @IsString()
  @IsOptional()
  id?: string;
}

export class CrearTicketUnificadoDto {
  @ApiProperty({ required: false, type: ReferenciaTicketDto })
  @IsOptional()
  referencia?: ReferenciaTicketDto;

  @ApiProperty({ required: false, example: 'Problema con la tarifa debitada' })
  @IsString()
  @IsOptional()
  titulo?: string;

  @ApiProperty({ required: false, example: 'El conductor cobró un recargo no estipulado.' })
  @IsString()
  @IsOptional()
  descripcion?: string;

  @ApiProperty({ required: false, example: 'usr-passenger-456' })
  @IsString()
  @IsOptional()
  usuarioId?: string;

  @ApiProperty({ required: false, example: 'MEDIA', enum: ['BAJA', 'MEDIA', 'ALTA', 'URGENTE'] })
  @IsString()
  @IsOptional()
  prioridad?: string;

  // Alias en inglés para soporte retrocompatible
  @IsString()
  @IsOptional()
  referenceId?: string;

  @IsEnum(TicketReferenceTypeDto)
  @IsOptional()
  referenceType?: TicketReferenceTypeDto;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  createdBy?: string;
}

export class CambiarEstadoTicketUnificadoDto {
  @ApiProperty({
    required: false,
    example: 'EN_REVISION',
    enum: [
      'ABIERTO',
      'EN_REVISION',
      'EN_CURSO',
      'RESUELTO',
      'CERRADO',
      'OPEN',
      'IN_PROGRESS',
      'RESOLVED',
      'CLOSED',
    ],
  })
  @IsString()
  @IsOptional()
  estado?: string;

  @ApiProperty({ required: false, enum: TicketStatusDto })
  @IsEnum(TicketStatusDto)
  @IsOptional()
  status?: TicketStatusDto;

  @ApiProperty({ required: false, example: 'Reintegro procesado a favor del pasajero.' })
  @IsString()
  @IsOptional()
  resolucion?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  resolutionNote?: string;

  @ApiProperty({ required: false, example: 'Revisión completada por operador.' })
  @IsString()
  @IsOptional()
  motivo?: string;
}
