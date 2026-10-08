import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

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
  @IsString()
  @IsNotEmpty()
  email: string;
}
