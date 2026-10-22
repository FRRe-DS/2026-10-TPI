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
- **Contratos Formales**: Especificación OpenAPI 3.1 en `contratos/m8_notificaciones/openapi.yml` y `packages/contracts/openapi.yaml`, con tipos TypeScript compartidos en `packages/contracts`.

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

# Sincronizar esquema de base de datos local
npm run prisma:migrate
```
