# Regla de Contratos OpenAPI y Validación de DTOs

Esta regla garantiza el cumplimiento estricto del requerimiento **RNF-03 (Contratos OpenAPI)**.

## 1. Documentación Obligatoria en Controladores NestJS
Cada endpoint en `apps/backend/` debe estar 100% documentado para la cátedra:

1. **Tag de Swagger**: Todo controlador debe tener `@ApiTags('NombreSubdominio')`.
2. **Operación**: Cada método debe contar con `@ApiOperation({ summary: '...', description: '...' })`.
3. **Respuestas Tipadas**:
   - `@ApiResponse({ status: 200/201, description: '...', type: ResponseDto })`
   - `@ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })`
   - `@ApiResponse({ status: 404, description: 'Recurso no encontrado' })`
   - `@ApiResponse({ status: 409, description: 'Conflicto o estado inválido' })`

## 2. Validación de Entrada (DTOs)
1. **Tipado Estricto**: Todo DTO de entrada debe usar decoradores de `class-validator` y `@ApiProperty()` de `@nestjs/swagger`.
2. **Ejemplo**:
   ```typescript
   export class CreateTicketDto {
     @ApiProperty({ description: 'ID del viaje, reserva o pago asociado', example: 'trip-12345' })
     @IsString()
     @IsNotEmpty()
     referenceId: string;

     @ApiProperty({ enum: ['TRIP', 'RESERVATION', 'PAYMENT'], example: 'TRIP' })
     @IsEnum(['TRIP', 'RESERVATION', 'PAYMENT'])
     referenceType: 'TRIP' | 'RESERVATION' | 'PAYMENT';

     @ApiProperty({ description: 'Motivo del reclamo', example: 'El conductor no llegó al punto acordado' })
     @IsString()
     @MinLength(10)
     description: string;
   }
   ```

## 3. Sincronización con `packages/contracts/openapi.yaml`
- El backend expone la especificación OpenAPI generada en `/api/docs-json`.
- Cada cambio significativo en la API debe reflejarse en `packages/contracts/openapi.yaml` para servir de contrato oficial hacia los demás grupos (M1 a M9).
