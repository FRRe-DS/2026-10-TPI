import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum NotificationChannelDto {
  EMAIL = 'EMAIL',
  PUSH = 'PUSH',
  SMS = 'SMS',
}

export class SendNotificationDto {
  @ApiProperty({ enum: NotificationChannelDto, default: NotificationChannelDto.EMAIL })
  @IsEnum(NotificationChannelDto)
  channel: NotificationChannelDto;

  @ApiProperty({ example: 'pasajero@ejemplo.com', description: 'Destinatario de la notificación' })
  @IsString()
  @IsNotEmpty()
  recipient: string;

  @ApiProperty({ example: 'Tu conductor está en camino', description: 'Asunto o título' })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({ example: 'El auto Toyota Corolla (AB123CD) llegará en 3 minutos.', description: 'Contenido' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ required: false, example: 'trip-98765' })
  @IsString()
  @IsOptional()
  referenceId?: string;

  @ApiProperty({ required: false, example: 'TRIP' })
  @IsString()
  @IsOptional()
  referenceType?: string;
}
