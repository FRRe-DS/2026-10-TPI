# Regla de Arquitectura Hexagonal y Modulación para M8

Esta regla es de estricto cumplimiento para todos los desarrolladores y agentes de IA que contribuyan en `apps/backend/`.

## 1. Principio Fundamental
Cada submódulo funcional de M8 (`notifications`, `documents`, `support`) debe estructurarse en **tres capas concéntricas**:

```text
apps/backend/src/modules/<submodule>/
├── domain/                    # Núcleo del Negocio (Sin dependencias externas)
│   ├── entities/              # Clases y modelos de dominio puros
│   ├── value-objects/         # Objetos de valor inmutables
│   ├── ports/                 # Interfaces de salida (Repositorios, Notificadores, Cache)
│   └── events/                # Eventos de dominio generados
├── application/               # Orquestación de Casos de Uso
│   ├── use-cases/             # Clases de acción única (ej. CreateTicketUseCase, GenerateQrUseCase)
│   ├── dto/                   # DTOs de entrada y salida de los casos de uso
│   └── ports/                 # Interfaces de servicios de aplicación
└── infrastructure/            # Adaptadores y Detalles Tecnológicos
    ├── controllers/           # Controladores REST de NestJS (Adaptadores de entrada HTTP)
    ├── consumers/             # Consumidores de RabbitMQ (Adaptadores de entrada AMQP)
    ├── persistence/           # Implementación de repositorios con Prisma ORM
    ├── adapters/              # Adaptadores de PDF, Redis, Mailpit / Nodemailer
    └── <submodule>.module.ts  # Módulo de NestJS para registrar inyección de dependencias
```

## 2. Reglas de Dependencia
1. **El Dominio (`domain`) es sagrado**:
   - PROHIBIDO importar `@nestjs/*`, `@prisma/client`, `typeorm`, `express`, o librerías de infraestructura en `domain/`.
   - El dominio solo conoce TypeScript estándar.
2. **La Aplicación (`application`) solo depende del Dominio**:
   - Los casos de uso llaman a los puertos (interfaces) definidos en `domain/ports/` o `application/ports/`.
   - NUNCA instancian directamente conexiones a base de datos, clientes de Redis o APIs externas.
3. **La Infraestructura (`infrastructure`) implementa los Puertos**:
   - Aquí residen los decoradores `@Controller()`, `@Injectable()`, `@ApiTags()`, queries de Prisma, y clientes de Redis/RabbitMQ.
   - En el `<submodule>.module.ts` se conectan las interfaces de dominio con sus implementaciones de infraestructura mediante proveedores de NestJS:
     ```typescript
     {
       provide: TICKET_REPOSITORY_PORT,
       useClass: PrismaTicketRepository,
     }
     ```

## 3. Manejo de Errores
- El dominio y la aplicación lanzan **Excepciones de Negocio / Dominio** (ej. `TicketNotFoundException`, `QrExpiredException`, `InvalidStatusTransitionException`).
- La capa de infraestructura traduce estas excepciones a códigos HTTP (404, 400, 409, etc.) mediante NestJS Exception Filters o mapeos explícitos.
