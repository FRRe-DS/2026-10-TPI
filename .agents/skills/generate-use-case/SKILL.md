---
name: generate-use-case
description: Genera la estructura de un caso de uso hexagonal (dominio, aplicación, puerto y adaptador) en NestJS respetando la arquitectura de M8.
---

# Skill: Generador de Casos de Uso Hexagonales

Esta skill asiste al desarrollador en la creación de un nuevo caso de uso dentro de uno de los submódulos de `apps/backend/src/modules/` (`notifications`, `documents`, `support`).

## Pasos de Ejecución

1. **Identificar el Submódulo y Caso de Uso**:
   - Determinar si pertenece a `notifications`, `documents`, o `support`.
   - Definir el nombre del caso de uso en PascalCase (ej. `GenerateQrCodeUseCase`, `CreateTicketUseCase`, `RetryNotificationUseCase`).

2. **Crear o Actualizar el Puerto de Salida en Dominio**:
   - Ubicación: `src/modules/<submodule>/domain/ports/<entity>.repository.port.ts`
   - Definir la interfaz TypeScript pura sin decoradores externos.

3. **Crear el Caso de Uso en Aplicación**:
   - Ubicación: `src/modules/<submodule>/application/use-cases/<action>.use-case.ts`
   - Inyectar el puerto utilizando el token o símbolo de inyección.
   - Implementar el método `execute(dto: RequestDto): Promise<ResponseDto>`.
   - Lanzar errores de dominio específicos si las reglas no se cumplen.

4. **Crear DTOs**:
   - Ubicación: `src/modules/<submodule>/application/dto/<action>.dto.ts`
   - Usar `class-validator` y `@ApiProperty()`.

5. **Crear o Enlazar en Infraestructura**:
   - Adaptador HTTP: Controller en `src/modules/<submodule>/infrastructure/controllers/` con decoradores de NestJS y Swagger.
   - Adaptador de Persistencia: Implementar el repositorio en `src/modules/<submodule>/infrastructure/persistence/` con Prisma ORM.

6. **Registrar en el Módulo NestJS**:
   - En `src/modules/<submodule>/<submodule>.module.ts`:
     - Registrar el Controller en `controllers: [...]`.
     - Registrar el UseCase en `providers: [...]`.
     - Vincular el puerto al repositorio en `providers: [{ provide: PORT_TOKEN, useClass: PrismaRepository }]`.

7. **Crear Test Unitario**:
   - Ubicación: `src/modules/<submodule>/application/use-cases/<action>.use-case.spec.ts`
   - Testear el caso de uso aislando el repositorio con un Mock en memoria.
