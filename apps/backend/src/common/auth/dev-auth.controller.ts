import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Public } from './auth.decorators';
import { DevTokenProviderService } from './dev-token-provider.service';

export class IssueDevTokenDto {
  @ApiPropertyOptional({ example: 'm8-frontend-simulator' })
  @IsString()
  @IsOptional()
  sub?: string;

  @ApiPropertyOptional({
    example: 'SERVICIO',
    enum: ['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO'],
  })
  @IsString()
  @IsOptional()
  role?: string;

  @ApiPropertyOptional({
    example: ['OPERADOR'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  roles?: string[];

  @ApiPropertyOptional({ example: 900, minimum: 30, maximum: 3600 })
  @IsInt()
  @Min(30)
  @Max(3600)
  @IsOptional()
  expiresInSeconds?: number;
}

@ApiTags('Autenticación (Solo Desarrollo)')
@Public()
@Controller('auth/dev')
export class DevAuthController {
  constructor(private readonly devTokenProvider: DevTokenProviderService) {}

  @Get('.well-known/jwks.json')
  @ApiOperation({
    summary: 'JWKS público del proveedor local de desarrollo (deshabilitado en producción)',
  })
  @ApiResponse({ status: 200, description: 'Conjunto de claves públicas JWK de desarrollo' })
  @ApiResponse({ status: 404, description: 'Proveedor de desarrollo deshabilitado' })
  getJwks() {
    if (!this.devTokenProvider.isEnabled()) {
      throw new NotFoundException('Recurso no disponible.');
    }
    return this.devTokenProvider.getJwks();
  }

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Emitir un JWT RS256 válido solo para desarrollo local (deshabilitado en producción)',
  })
  @ApiResponse({ status: 200, description: 'Token JWT firmado RS256 emitido para pruebas locales' })
  @ApiResponse({ status: 404, description: 'Proveedor de desarrollo deshabilitado' })
  issueToken(@Body() dto: IssueDevTokenDto) {
    if (!this.devTokenProvider.isEnabled()) {
      throw new NotFoundException('Recurso no disponible.');
    }
    return this.devTokenProvider.issueToken(dto);
  }
}
