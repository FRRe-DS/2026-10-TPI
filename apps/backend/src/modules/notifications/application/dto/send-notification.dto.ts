import { ApiProperty } from '@nestjs/swagger';
import {
  isEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

export enum NotificationChannelDto {
  EMAIL = 'EMAIL',
  PUSH = 'PUSH',
  SMS = 'SMS',
}

export interface NotificationAttachmentDto {
  filename: string;
  content: Buffer | Uint8Array;
  contentType?: string;
}

function IsEmailForEmailChannel(validationOptions?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'isEmailForEmailChannel',
      target: target.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const dto = args.object as SendNotificationDto;
          return (
            dto.channel !== NotificationChannelDto.EMAIL ||
            (typeof value === 'string' && isEmail(value))
          );
        },
      },
    });
  };
}

export class SendNotificationDto {
  @ApiProperty({ enum: NotificationChannelDto, default: NotificationChannelDto.EMAIL })
  @IsEnum(NotificationChannelDto)
  channel: NotificationChannelDto;

  @ApiProperty({ example: 'pasajero@ejemplo.com', description: 'Destinatario de la notificación' })
  @IsEmailForEmailChannel()
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

  @IsOptional()
  attachments?: NotificationAttachmentDto[];
}

export class ReferenciaNotificacionDto {
  @ApiProperty({ example: 'VIAJE', enum: ['VIAJE', 'RESERVA', 'PAGO'] })
  @IsString()
  @IsOptional()
  tipo?: string;

  @ApiProperty({ example: 'trip-98765' })
  @IsString()
  @IsOptional()
  id?: string;
}

/**
 * DTO para el endpoint canónico POST /api/v1/notificaciones (NotificacionNueva)
 * con soporte retrocompatible en inglés.
 */
export class EnviarNotificacionUnificadaDto {
  @ApiProperty({ required: false, example: 'usr-uuid-123' })
  @IsString()
  @IsOptional()
  destinatarioId?: string;

  @ApiProperty({ required: false, example: 'pasajero@ejemplo.com' })
  @IsString()
  @IsOptional()
  destinatario?: string;

  @ApiProperty({ required: false, example: 'CLIENTE', enum: ['CLIENTE', 'CONDUCTOR'] })
  @IsString()
  @IsOptional()
  rol?: string;

  @ApiProperty({ required: false, enum: NotificationChannelDto, default: NotificationChannelDto.EMAIL })
  @IsEnum(NotificationChannelDto)
  @IsOptional()
  canal?: NotificationChannelDto;

  @ApiProperty({ required: false, example: 'Tu conductor está en camino' })
  @IsString()
  @IsOptional()
  asunto?: string;

  @ApiProperty({ required: false, example: 'El vehículo llegará en 5 minutos.' })
  @IsString()
  @IsOptional()
  mensaje?: string;

  @ApiProperty({ required: false, type: ReferenciaNotificacionDto })
  @IsOptional()
  referencia?: ReferenciaNotificacionDto;

  // Alias en inglés para retrocompatibilidad
  @IsEnum(NotificationChannelDto)
  @IsOptional()
  channel?: NotificationChannelDto;

  @IsString()
  @IsOptional()
  recipient?: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsString()
  @IsOptional()
  referenceId?: string;

  @IsString()
  @IsOptional()
  referenceType?: string;
}
