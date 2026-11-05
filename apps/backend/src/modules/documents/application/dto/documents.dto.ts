import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GenerateQrDto {
  @ApiProperty({ example: 'trip-abc-123', description: 'ID del viaje al que corresponde el QR' })
  @IsString()
  @IsNotEmpty()
  tripId: string;

  @ApiProperty({ example: 'usr-p-456', description: 'ID del pasajero' })
  @IsString()
  @IsNotEmpty()
  passengerId: string;

  @ApiProperty({ example: 300, description: 'Tiempo de vida (TTL) en segundos', default: 300 })
  @IsNumber()
  @IsOptional()
  ttlSeconds?: number;
}

export class VerifyQrDto {
  @ApiProperty({ example: 'qr-token-sec-xyz', description: 'Token único escaneado del QR' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'trip-abc-123', description: 'ID del viaje que se intenta iniciar' })
  @IsString()
  @IsNotEmpty()
  tripId: string;
}

export class ResendReceiptDto {
  @ApiProperty({ example: 'trip-abc-123', description: 'ID del viaje del comprobante' })
  @IsString()
  @IsNotEmpty()
  tripId: string;

  @ApiProperty({ example: 'pasajero@ejemplo.com', description: 'Email de destino para el reenvío' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class ResendReceiptResponseDto {
  @ApiProperty({ example: true, description: 'Indica si el reenvío fue exitoso' })
  success: boolean;

  @ApiProperty({ example: 'trip-abc-123', description: 'ID del viaje del comprobante' })
  tripId: string;

  @ApiProperty({ example: 'REC-2026-00001', description: 'Código único del comprobante reenviado' })
  receiptCode: string;

  @ApiProperty({ example: 'pasajero@ejemplo.com', description: 'Destinatario del correo' })
  sentTo: string;

  @ApiProperty({ example: '2026-10-17T15:40:00.000Z', description: 'Marca temporal del reenvío' })
  timestamp: string;
}


export class RegisterReceiptDto {
  @ApiProperty({
    example: 'trip-abc-123',
    description: 'ID del viaje finalizado (viene de TripCompletedEvent de M6)',
  })
  @IsString()
  @IsNotEmpty()
  tripId: string;

  @ApiProperty({
    example: 'usr-p-456',
    description: 'ID del pasajero',
  })
  @IsString()
  @IsNotEmpty()
  passengerId: string;

  @ApiProperty({
    example: 'pasajero@ejemplo.com',
    description: 'Email del pasajero',
  })
  @IsEmail()
  @IsNotEmpty()
  passengerEmail: string;

  @ApiProperty({
    example: 3500,
    description: 'Importe total abonado',
  })
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  amount: number;

  @ApiProperty({
    example: 'ARS',
    default: 'ARS',
    description: 'Moneda del cobro',
    required: false,
  })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiProperty({
    example: 'Juan Conductor',
    description: 'Nombre del conductor (opcional)',
    required: false,
  })
  @IsString()
  @IsOptional()
  driverName?: string;
}

export class ReceiptResponseDto {
  @ApiProperty({ example: 'b3f5e128-485a-4cb7-9f79-633006d15655' })
  id: string;

  @ApiProperty({ example: 'REC-2026-00001' })
  receiptCode: string;

  @ApiProperty({ example: 'trip-abc-123' })
  tripId: string;

  @ApiProperty({ example: 'usr-p-456' })
  passengerId: string;

  @ApiProperty({ example: 'pasajero@ejemplo.com' })
  passengerEmail: string;

  @ApiProperty({ example: 3500 })
  amount: number;

  @ApiProperty({ example: 'ARS' })
  currency: string;

  @ApiProperty({ example: 'Juan Conductor', required: false, nullable: true })
  driverName?: string;

  @ApiProperty({
    example: '2026-10-17T12:00:00.000Z',
    description: 'Fecha de emisión original del comprobante',
  })
  issuedAt: string;
}

// ─── DTOs para el Contrato Coordinado Definitivo (G10 + G7) ─────────────────

export class GenerarQrViajeDto {
  @ApiProperty({ required: false, example: 'usr-p-456', description: 'Identificador del cliente' })
  @IsString()
  @IsOptional()
  clienteId?: string;

  @ApiProperty({ required: false, example: 'usr-p-456', description: 'Alias en inglés de clienteId' })
  @IsString()
  @IsOptional()
  passengerId?: string;

  @ApiProperty({ required: false, example: 600, default: 600, description: 'Validez del QR en segundos' })
  @IsNumber()
  @IsOptional()
  validezSegundos?: number;

  @ApiProperty({ required: false, example: 300, default: 300 })
  @IsNumber()
  @IsOptional()
  ttlSeconds?: number;
}

export class ValidarQrUnificadoDto {
  @ApiProperty({ example: 'qr-token-sec-xyz', description: 'Token opaco del código QR' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ required: false, example: 'trip-abc-123', description: 'ID del viaje (viajeId)' })
  @IsString()
  @IsOptional()
  viajeId?: string;

  @ApiProperty({ required: false, example: 'trip-abc-123', description: 'Alias en inglés (tripId)' })
  @IsString()
  @IsOptional()
  tripId?: string;
}

export class ImporteComprobanteDto {
  @ApiProperty({ example: 3500 })
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  monto: number;

  @ApiProperty({ required: false, example: 'ARS', default: 'ARS' })
  @IsString()
  @IsOptional()
  moneda?: string;
}

export class RegistrarComprobanteUnificadoDto {
  @ApiProperty({ required: false, example: 'trip-abc-123' })
  @IsString()
  @IsOptional()
  viajeId?: string;

  @ApiProperty({ required: false, example: 'trip-abc-123' })
  @IsString()
  @IsOptional()
  tripId?: string;

  @ApiProperty({ required: false, example: 'pay-uuid-2002' })
  @IsString()
  @IsOptional()
  pagoId?: string;

  @ApiProperty({ required: false, example: 'usr-p-456' })
  @IsString()
  @IsOptional()
  clienteId?: string;

  @ApiProperty({ required: false, example: 'usr-p-456' })
  @IsString()
  @IsOptional()
  passengerId?: string;

  @ApiProperty({ required: false, example: 'pasajero@ejemplo.com' })
  @IsEmail()
  @IsOptional()
  clienteEmail?: string;

  @ApiProperty({ required: false, example: 'pasajero@ejemplo.com' })
  @IsEmail()
  @IsOptional()
  passengerEmail?: string;

  @ApiProperty({ required: false, example: 'Juan Conductor' })
  @IsString()
  @IsOptional()
  conductorNombre?: string;

  @ApiProperty({ required: false, example: 'Juan Conductor' })
  @IsString()
  @IsOptional()
  driverName?: string;

  @ApiProperty({ required: false, example: 'FINALIZACION_VIAJE' })
  @IsString()
  @IsOptional()
  motivo?: string;

  @ApiProperty({ required: false, type: ImporteComprobanteDto })
  @IsOptional()
  importe?: ImporteComprobanteDto;

  @ApiProperty({ required: false, example: 3500 })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  amount?: number;

  @ApiProperty({ required: false, example: 'ARS' })
  @IsString()
  @IsOptional()
  currency?: string;
}

export class ReenviarComprobanteUnificadoDto {
  @ApiProperty({ required: false, example: 'EMAIL', default: 'EMAIL', enum: ['EMAIL', 'SMS', 'PUSH'] })
  @IsString()
  @IsOptional()
  canal?: string;

  @ApiProperty({ required: false, example: 'pasajero@ejemplo.com' })
  @IsEmail()
  @IsOptional()
  emailDestino?: string;

  @ApiProperty({ required: false, example: 'pasajero@ejemplo.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ required: false, example: 'trip-abc-123' })
  @IsString()
  @IsOptional()
  tripId?: string;
}
