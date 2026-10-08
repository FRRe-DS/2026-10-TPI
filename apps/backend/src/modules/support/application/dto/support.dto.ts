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
