# Arquitectura de Software - Módulo 8 (G10-M8)

**Materia**: Desarrollo de Software - 2026  
**Módulo**: M8 - Notificaciones, Documentos y Soporte  
**Grupo**: Grupo 10  

---

## 1. Justificación Tecnológica y Arquitectónica (RNF-01, RNF-02)

Para garantizar **modulación coherente, bajo acoplamiento y alta testabilidad**, el Módulo 8 implementa una **Arquitectura Hexagonal (Puertos y Adaptadores)** dentro de un monorepo administrado con `npm workspaces`:

- **Lenguaje Transversal**: TypeScript en Backend y Frontend para coherencia y tipado de extremo a extremo.
- **Backend Framework**: NestJS, elegido por su sistema de módulos encapsulados (`@Module`), contenedor de inyección de dependencias nativo y soporte de microservicios.
- **Frontend Dashboard**: React + Vite para operaciones internas (gestión de tickets de soporte, tracking de avisos y validación de QR).
- **Contratos Formales**: Especificación OpenAPI 3.1 Unificada y Consolidada (acordada formalmente entre el Grupo 10 y el Grupo 7) en `contratos/m8_notificaciones/openapi.yml` y `packages/contracts/openapi.yaml`, con tipos TypeScript y esquemas AMQP compartidos en `packages/contracts` y detalle en `PROPUESTA_UNIFICACION_M8.md`.

---

## 2. Organización en Capas Concétricas (Hexagonal)

Cada submódulo dentro de `apps/backend/src/modules/` respeta estrictamente el principio de inversión de dependencias:

```text
               ┌────────────────────────────────────────────────────────┐
               │                  INFRAESTRUCTURA                       │
               │  • Controllers REST (NestJS)   • RabbitMQ Listeners    │
               │  • Prisma Repositories (Postgres)                      │
               │  • Redis Adapter (QR TTL)      • Nodemailer (Mailpit)  │
               │                                                        │
               │        ┌──────────────────────────────────────┐        │
               │        │              APLICACIÓN              │        │
               │        │  • UseCases (Orquestación de reglas) │        │
               │        │  • DTOs con validaciones             │        │
               │        │  • Interfaces de Servicios (Puertos) │        │
               │        │                                      │        │
               │        │        ┌────────────────────┐        │        │
               │        │        │      DOMINIO       │        │        │
               │        │        │  • Entidades puras │        │        │
               │        │        │  • Value Objects   │        │        │
               │        │        │  • Puertos Salida  │        │        │
               │        │        └────────────────────┘        │        │
               │        └──────────────────────────────────────┘        │
               └────────────────────────────────────────────────────────┘
```

1. **Dominio (`domain/`)**: Contiene la lógica del negocio pura y contratos de puertos (`ports/`) sin dependencias de NestJS, base de datos ni librerías de terceros.
2. **Aplicación (`application/`)**: Orquesta los flujos de negocio mediante Casos de Uso (`use-cases/`) que interactúan exclusivamente a través de puertos.
3. **Infraestructura (`infrastructure/`)**: Implementa los puertos mediante adaptadores tecnológicos (`adapters/` y `persistence/`) sobre Prisma, Redis, RabbitMQ y PDFKit.

---

## 3. Persistencia y Flexibilidad en la Nube (RNF-04, RNF-05, Supabase)

- **Propiedad de los Datos (RNF-05)**: M8 posee sus propias tablas en PostgreSQL y no realiza lecturas ni escrituras directas sobre bases de datos de otros módulos. Todas las integraciones con M5, M6, M7 y M9 se realizan mediante APIs REST o eventos de dominio.
- **Persistencia Agnóstica**: Se utiliza **Prisma ORM**. Esto permite operar de forma indistinta sobre:
  - Un contenedor **PostgreSQL 16 Alpine local** administrado con Docker Compose para desarrollo offline.
  - Una instancia gestionada de **Supabase Cloud** (mediante Transaction Pooler en el puerto `6543` o Session Pooler/Direct en el `5432`) para despliegue en la nube y trabajo distribuido sin levantar Docker.
- **Estado Efímero y TTL (RF-8.3, RNF-11)**: Los códigos QR temporales se registran en **Redis** con un tiempo de vida estricto (TTL de 300 segundos). Al ser verificados por primera vez por el conductor, el token se consume y elimina de forma atómica (`GETDEL`) para impedir reutilizaciones (RNF-08).
- **Consumo Asíncrono Desacoplado (RF-8.8, RNF-10)**: M8 consume eventos de RabbitMQ emitidos por M5, M6, M7 y M9 sin bloquear el flujo transaccional principal.

---

## 4. Contenedores y Dependencias de Infraestructura (RNF-04, Docker Compose)

El archivo [`docker-compose.yml`](docker-compose.yml) define las cuatro dependencias de infraestructura necesarias para ejecutar el microservicio de forma 100% reproducible y aislada:

### Matriz de Servicios en Docker Compose

| Servicio | Contenedor | Imagen OCI | Puertos Expuestos | Persistencia (Volumen) | Healthcheck Configurado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **PostgreSQL** | `g10_m8_postgres` | `postgres:16-alpine` | `5432:5432` | `postgres_data:/var/lib/postgresql/data` | `pg_isready -U postgres -d m8_db` (interval 5s, timeout 5s, 5 retries) |
| **Redis** | `g10_m8_redis` | `redis:7-alpine` | `6379:6379` | `redis_data:/data` | `redis-cli ping` (interval 5s, timeout 5s, 5 retries) |
| **RabbitMQ** | `g10_m8_rabbitmq` | `rabbitmq:3-management-alpine` | `5672:5672` (AMQP)<br>`15672:15672` (UI) | `rabbitmq_data:/var/lib/rabbitmq` | `rabbitmq-diagnostics check_running` (interval 10s, timeout 5s, 5 retries) |
| **Mailpit** | `g10_m8_mailpit` | `axllent/mailpit:latest` | `1025:1025` (SMTP)<br>`8025:8025` (UI) | Efímero / En memoria | `healthy` por defecto |

### Consolas de Administración Local
- **RabbitMQ Management**: [http://localhost:15672](http://localhost:15672) (Usuario: `guest`, Contraseña: `guest`). Permite monitorear colas, exchanges y tasas de consumo de mensajes.
- **Mailpit Web UI**: [http://localhost:8025](http://localhost:8025). Permite visualizar en tiempo real todos los correos enviados por Nodemailer (notificaciones y reenvío de comprobantes PDF) sin necesidad de conectar un proveedor SMTP real en desarrollo.

### Comandos de Operación
El monorepo cuenta con scripts configurados en el [`package.json`](package.json) raíz:

```bash
# Iniciar todos los contenedores en segundo plano
npm run docker:up

# Verificar estado y healthchecks de los contenedores
docker compose ps

# Ver logs unificados o de un servicio específico
npm run docker:logs
# o: docker compose logs -f postgres redis

# Detener todos los contenedores preservando datos en volúmenes
npm run docker:down

# Sincronizar esquema de base de datos local o remota
npm run prisma:push
npm run prisma:migrate
```

---

## 5. Empaquetado OCI y Dockerfile Multi-Stage (RNF-04)

Cumpliendo con **RNF-04**, el microservicio M8 Backend se empaqueta en una imagen de contenedor OCI reproducible, basada en `node:20-alpine`, utilizando una estrategia multi-etapa (`multi-stage build`):

1. **Etapa `builder`**:
   - Instala dependencias con `npm ci`.
   - Genera el cliente tipado de Prisma (`prisma generate`).
   - Compila el paquete interno `@g10-m8/contracts` y el microservicio `@g10-m8/backend` (`nest build`).
2. **Etapa `runner`**:
   - Parte de una imagen limpia y minimalista `node:20-alpine`.
   - Copia únicamente los artefactos compilados (`dist/`), `node_modules` y esquemas de Prisma.
   - Configura el usuario seguro sin privilegios `USER node`.
   - Expone el puerto `3000` y define un `HEALTHCHECK` activo contra `/api/v1/health`.

### Comandos de Construcción y Ejecución de la Imagen

```bash
# Construir la imagen del backend
docker build -t g10-m8-backend:latest .

# Ejecutar el contenedor
docker run -p 3000:3000 --env-file apps/backend/.env g10-m8-backend:latest
```

---

## 6. Esquema de Datos, Migraciones y Supabase Cloud (RNF-05)

El microservicio es el propietario exclusivo (**RNF-05**) de las siguientes 5 entidades de dominio:

1. **`NotificationLog`**: Bitácora auditable de cada notificación enviada (Email, SMS, Push, WhatsApp), estado del delivery (`PENDING`, `SENT`, `FAILED`), destinatario y reintentos.
2. **`DocumentReceipt`**: Comprobante oficial de viaje emitido con `receiptCode` alfanumérico único (`REC-2026-XXXXXX`), datos del viaje (`tripId`, `passengerId`, `driverId`, monto, fecha) y URL/hash del PDF.
3. **`QrVerificationToken`**: Token criptográfico para validación de acceso al viaje con control de expiración (`expiresAt`) y consumo único (`used`).
4. **`SupportTicket`**: Incidencias y reclamos de pasajeros y conductores con código `TCK-2026-XXXXXX`, categorización, prioridad y máquina de estados (`OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`).
5. **`TicketMessage`**: Mensajes cronológicos y auditoría asociados a cada ticket de soporte.

### Trazabilidad de Esquema y Migraciones SQL

La estructura de la base de datos se mantiene versionada formalmente en:
- `apps/backend/prisma/schema.prisma`: Definición declarativa de modelos y relaciones.
- `apps/backend/prisma/migrations/20261022000000_init/migration.sql`: Migración DDL inicial para PostgreSQL.
- `apps/backend/prisma/migrations/migration_lock.toml`: Bloqueo de proveedor (`postgresql`).

Para desplegar y sincronizar:
```bash
# Sincronización declarativa directa (entornos de desarrollo / Supabase)
npm run prisma:push

# Aplicar migraciones SQL pendientes (producción / CI-CD)
npx prisma migrate deploy --schema=apps/backend/prisma/schema.prisma
```

---

## 7. Pipeline de Integración Continua (RNF-07, CI)

El repositorio cuenta con un pipeline automatizado de GitHub Actions configurado en [`.github/workflows/ci.yml`](.github/workflows/ci.yml) que valida en cada `push` o `pull_request` a `main` y `develop`:

1. **Instalación limpia de dependencias** (`npm ci`).
2. **Generación automática de Prisma Client** (`npm run prisma:generate`) para garantizar tipado estático en el runner.
3. **Validación estricta de linters y TypeScript** (`npm run lint` / `tsc --noEmit`).
4. **Ejecución del 100% de la suite de pruebas unitarias y de integración** (`npm run test`).
5. **Compilación de todos los workspaces** (`npm run build`).
6. **Validación de reproducibilidad del contenedor Docker** (`docker build -t g10-m8-backend:test .`).

---

## 8. Acuerdo de Integración Inter-Grupos y Contrato Unificado (Grupo 10 + Grupo 7)

Para garantizar la interoperabilidad con los demás módulos (M1 a M7 y M9) exigida por la cátedra (**RNF-02, RNF-03**), el Grupo 10 y el Grupo 7 consolidaron sus especificaciones en un **Contrato OpenAPI 3.1 Unificado Oficial** ([`packages/contracts/openapi.yaml`](packages/contracts/openapi.yaml) y [`contratos/m8_notificaciones/openapi.yml`](contratos/m8_notificaciones/openapi.yml)).

Este acuerdo se fundamenta en la propuesta documentada en [`PROPUESTA_UNIFICACION_M8.md`](PROPUESTA_UNIFICACION_M8.md) y se rige por los siguientes principios arquitectónicos:

### 8.1. Convención de Ruteo e Idioma Canónico
- **Rutas Públicas Oficiales en Español (`/api/v1/...`)**: Se adopta el vocabulario de dominio del enunciado oficial (`/api/v1/notificaciones`, `/api/v1/comprobantes`, `/api/v1/tickets`, `/api/v1/viajes/{viajeId}/qr`).
- **Arquitectura de Rutas Bivalentes en NestJS**: Para no romper el Dashboard Frontend existente ni los tests unitarios previos, los controladores de infraestructura exponen rutas bivalentes mediante decoradores multi-ruta:
  ```typescript
  @Controller(['api/v1/tickets', 'support/tickets'])
  export class SupportController { ... }
  ```
  Esto permite responder tanto a las peticiones externas de los demás módulos de la plataforma como a las llamadas internas del dashboard visual sin sobrecosto de mantenimiento.

### 8.2. Ingestión Dual de Eventos (RF-8.1, RF-8.2, RF-8.8)
- **Canal HTTP Síncrono/Asíncrono (`POST /api/v1/eventos`)**: Permite que M5, M6, M7 y M9 envíen hitos de viaje, reserva o pago mediante peticiones HTTP que responden de forma inmediata `202 Accepted` sin bloquear al emisor. Esencial para la etapa TP1 antes de contar con un broker federado inter-máquinas.
- **Canal AMQP Desacoplado (RabbitMQ)**: Se mantiene el catálogo formal de esquemas de eventos en `components/schemas` (`TripCompletedEvent`, `PaymentCapturedEvent`, `ReservationConfirmedEvent`, etc.) consumidos por el adaptador `trip-completed.consumer.ts` para la etapa TP2.

### 8.3. Ciclo de Vida Polimórfico de Comprobantes (RF-8.4, RF-8.5)
- **Descarga Polimórfica (`GET /api/v1/comprobantes/{comprobanteId}/pdf`)**: El parámetro de ruta resuelve indistintamente si el cliente envía el UUID del comprobante o el identificador del viaje (`viajeId` / `tripId`). Esto elimina la necesidad de realizar consultas previas de búsqueda desde M6 o desde la app del pasajero.
- **Emisión Dual**: Generación automática reactiva ante eventos de viaje o pago, sumada al endpoint síncrono `POST /api/v1/comprobantes` como fallback operativo y de pruebas.

### 8.4. Identidad Híbrida en Soporte y Reclamos (RF-8.7)
- **Prioridad JWT Bearer**: Si la solicitud incluye el token Bearer emitido por M1, la identidad del autor (`usuarioId`) y su `rol` se extraen obligatoriamente del claim `sub` y scopes del token, previniendo suplantación de identidad (RNF-12).
- **Fallback en Desarrollo**: Para pruebas locales aisladas o desde Swagger sin M1 activo, se admite el atributo opcional `usuarioId` en el cuerpo de `TicketNuevo`.

### 8.5. Estandarización de Errores con RFC 9457
- Toda la API responde errores con la estructura formal de **RFC 9457 Problem Details** (`application/problem+json`), formateada a través de un `ProblemDetailsExceptionFilter` global en NestJS.


