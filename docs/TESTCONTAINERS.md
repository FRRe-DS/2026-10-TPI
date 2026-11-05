# Tema 25 — Pruebas de integración con Testcontainers (Grupo 10, M8)

> **ESTADO: la ejecución con Docker está PENDIENTE.**
> Esta suite se implementó y se verificó *estáticamente* (compilación, tipos y listado de pruebas)
> en una PC sin Docker. **Ningún test de integración se ejecutó todavía.** La ejecución real y la
> captura de evidencias se harán en la PC de un compañero (ver [§5](#5-ejecución-paso-a-paso-pc-con-docker)).

## 1. ¿Qué problema resuelve Testcontainers?

Las pruebas unitarias del repositorio usan **dobles de prueba** (mocks): son rápidas, pero no
demuestran que Prisma, el esquema SQL, las migraciones y el motor PostgreSQL funcionen juntos
(por ejemplo, un `advisory lock`, una restricción `UNIQUE` o un tipo `Decimal`).

[Testcontainers para Node.js](https://node.testcontainers.org/) levanta **dependencias reales y
desechables** (aquí, un contenedor PostgreSQL) desde el propio código de la prueba:

| Ventaja | Detalle |
| --- | --- |
| Fidelidad | Se prueba contra PostgreSQL real, no contra un mock ni un SQLite. |
| Aislamiento | Cada corrida crea su propia base, con puerto aleatorio y credenciales aleatorias. No toca Supabase ni bases compartidas. |
| Reproducibilidad | Cualquier integrante con Docker obtiene el mismo entorno; sin instalar PostgreSQL. |
| Limpieza automática | Se detiene/elimina el contenedor al terminar; el contenedor *Ryuk* limpia huérfanos si el proceso muere. |

| Limitación | Detalle |
| --- | --- |
| Requiere Docker (o runtime compatible) | No corre sin un daemon de contenedores. |
| Más lento que una prueba unitaria | Arranque del contenedor (segundos) y descarga de imagen la primera vez. |
| Recursos | Consume CPU/RAM/disco; en CI requiere runners con Docker. |
| Cobertura acotada | Solo valida lo que se levanta realmente (aquí, solo PostgreSQL). |

### Relación con el Docker Compose del Tema 14

| | Docker Compose (Tema 14) | Testcontainers (Tema 25) |
| --- | --- | --- |
| Propósito | Levantar **todo el sistema** (backend, simulador M6, PostgreSQL, Redis, RabbitMQ, Mailpit) para desarrollo y demo. | Levantar **solo lo necesario** para una prueba automatizada. |
| Ciclo de vida | Manual (`docker compose up/down`), con volúmenes persistentes. | Programático y efímero: nace y muere con la prueba. |
| Puertos | Fijos (`5432`, `6379`, ...). | **Dinámicos** (sin colisiones con el Compose ni con un PostgreSQL local). |
| Datos | Persisten. | Se descartan. |

Usamos la **misma versión de imagen** que el Compose (`postgres:16-alpine`), por lo que las
pruebas validan contra el mismo motor que usa el sistema desplegado. Ambos conviven sin
conflicto: Testcontainers no usa el puerto `5432`.

## 2. Qué flujo se prueba y por qué

La app NestJS **completa** (`AppModule`) se levanta en memoria y se ejercita por **HTTP real**
(supertest) con controladores, validación, casos de uso, repositorios Prisma, `PrismaService`
y PostgreSQL reales. El esquema se crea aplicando las **migraciones existentes**
(`prisma migrate deploy`, migración `20261022000000_init`).

Compatibilidad de las migraciones verificada antes de usarlas: se comparó `migration.sql` contra
`schema.prisma` (5 enums, 5 tablas, índices únicos y no únicos, FK `TicketMessage → SupportTicket`
con `ON DELETE CASCADE`): coinciden. Además, `migrate deploy` falla de forma explícita si no se
pueden aplicar, por lo que la **primera ejecución con Docker lo confirmará**.

### Comprobantes PDF (RF-8.4) — `documents-receipts.integration.spec.ts`

Se eligió porque su lógica depende justamente de la base real: idempotencia por `tripId` sin
`UNIQUE` (resuelta con `pg_advisory_xact_lock`), unicidad de `receiptCode` y fecha de emisión
persistida. Antes, la concurrencia solo podía afirmarse con mocks; con PostgreSQL real **puede
demostrarse**.

| Caso | Qué verifica |
| --- | --- |
| Registro | `POST /api/v1/documents/receipts` → 201; la fila existe en la BD con importe, metadatos y `createdAt = issuedAt`. |
| Repetición | Mismo `tripId` dos veces → mismo `id`, `receiptCode`, `issuedAt`; 1 sola fila. |
| Simultaneidad | 8 `POST` en paralelo del mismo `tripId` → un único `id`/`receiptCode`; 1 sola fila. |
| Viajes distintos | Comprobantes distintos y `receiptCode` único. |
| Validación | Cuerpo inválido → 400 y nada persistido. |
| Descarga | `GET .../:tripId/download` → 200, `application/pdf`, nombre `comprobante-<receiptCode>.pdf`, bytes que empiezan con `%PDF-`; no crea filas y conserva la fecha original. |
| Inexistente | `GET` de `tripId` no registrado → 404 y nada persistido. |

### Tickets de soporte (RF-8.7) — `support-tickets.integration.spec.ts` (CRUD)

Para la consigna de "CRUD completo" se revisaron los flujos existentes: **los tickets de soporte
exponen Create, Read y Update** (`POST /support/tickets`, `GET /support/tickets`,
`GET /support/tickets/:id`, `PATCH /support/tickets/:id/status`).
**No existe `DELETE` en producción y no se agregó solo para la demo.** El "Delete" de la
consigna se cubre únicamente como **limpieza de datos entre pruebas** (`TRUNCATE` protegido), no como
endpoint. Si la cátedra exigiera `DELETE` por API, debe decidirse como tarea aparte del equipo.

| Caso | Qué verifica |
| --- | --- |
| Create | 201, estado `OPEN`, `ticketNumber` con formato `TCK-2026-XXXXXX`, fila persistida. |
| Create inválido | 400 y nada persistido. |
| Read | Por UUID y por `ticketNumber`, listado, filtro `referenceId`, 404 inexistente. |
| Update | `OPEN → IN_PROGRESS → RESOLVED → CLOSED` con persistencia de cada estado y `resolutionNote`. |
| Update inválido | Transición no permitida y ticket `CLOSED` → 400; ticket inexistente → 404. |

## 3. Seguridad: la suite solo opera sobre la base temporal

* La conexión sale **exclusivamente del contenedor** (`container.getConnectionUri()`).
  No se carga ningún `.env` y no se usa Supabase (`main.ts`, que sí carga `dotenv`, no se importa).
* `prisma migrate deploy` se ejecuta sobre una **copia temporal** de `schema.prisma` + `migrations/`,
  para que la CLI de Prisma no encuentre ningún `.env` del repositorio.
* Guardián (`support/temporary-database.guard.ts`, con pruebas unitarias sin Docker) con defensa en profundidad:
  1. Usuario y base "centinela" (`m8_test_user` / `m8_integration_test`), contraseña aleatoria por corrida, host que no sea Supabase/pooler.
  2. Rechaza si el `host:puerto` coincide con cualquier URL PostgreSQL de las variables de entorno (`DATABASE_URL`, `DIRECT_URL`, ...).
  3. Antes de **cada** `TRUNCATE` consulta `current_database()`, `current_user` y un **marcador** (`COMMENT ON DATABASE`) con el `runId` de la corrida. Si algo no coincide, aborta.
* Las URLs y contraseñas se redactan en los mensajes de error.

## 4. Qué queda fuera del alcance (dobles de prueba)

| Integración | Estado en esta suite |
| --- | --- |
| PostgreSQL | **Real** (Testcontainers). |
| SMTP / Mailpit | **Reemplazado** por `RecordingNotificationSender` (en memoria). El reenvío de comprobantes por correo (RF-8.5) **no** se prueba aquí; la prueba SMTP con PDF adjunto sigue pendiente. |
| Redis | **Reemplazado** por `InMemoryRedisDouble`. No se prueba TTL real de QR. |
| RabbitMQ | **Reemplazado** (`TripCompletedConsumer` anulado). No se prueba el consumo del evento `trip.completed`. |
| Supabase | **No se usa.** |
| Simulador M6 (`apps/simulador-m6`) | No participa. |

Limitaciones adicionales: todo corre en un único proceso Node (no hay red entre servicios);
las pruebas comparten un contenedor por corrida y se aíslan con `TRUNCATE` entre casos; el
contenido textual del PDF no se inspecciona (su fecha/zona horaria está cubierta por pruebas unitarias).

## 5. Ejecución paso a paso (PC con Docker)

### Requisitos
* Docker Desktop (o Docker Engine) **en ejecución**: `docker info` debe responder sin errores.
* Node.js 20 o superior (el proyecto usa Node 20 en CI y en el `Dockerfile`).
* Acceso a Docker Hub la primera vez (descarga `postgres:16-alpine` y la imagen `testcontainers/ryuk`).
* No hace falta `.env`, Supabase, SMTP, Redis ni RabbitMQ.

### Comandos (desde la raíz del repositorio, rama `test/m8-testcontainers`)

```bash
npm ci
npm run prisma:generate
npm run build --workspace=@g10-m8/contracts

# Pruebas unitarias (NO requieren Docker; deben seguir pasando)
npm test --workspace=@g10-m8/backend

# Pruebas de integración con Testcontainers (requieren Docker)
npm run test:integration --workspace=@g10-m8/backend
```

En PowerShell de Windows, si `npm` está bloqueado por la política de ejecución, usar `npm.cmd`.
Atajo desde la raíz: `npm run test:integration`.

Opcional: `M8_TEST_POSTGRES_IMAGE=postgres:16-alpine` fija otra imagen. Para ver los logs de
Testcontainers: `DEBUG=testcontainers* npm run test:integration` (PowerShell: `$env:DEBUG='testcontainers*'`).

### Qué debería ocurrir
1. Jest ejecuta el `globalSetup`: arranca PostgreSQL, aplica la migración y marca la base.
2. Corren 2 suites (comprobantes y tickets); entre casos se vacían las tablas.
3. El `globalTeardown` detiene y elimina el contenedor.
4. Al terminar, `docker ps -a` **no** debe mostrar contenedores `postgres:16-alpine` de la corrida.

### Diagnóstico rápido
| Síntoma | Causa probable |
| --- | --- |
| `No se pudo iniciar el contenedor PostgreSQL...` | Docker apagado o sin permisos. |
| Timeout en el arranque | Primera descarga de imagen lenta: reintentar. |
| `Falló "prisma migrate deploy"...` | Migración incompatible o motor de Prisma no instalado (`npm ci`). |
| `UnsafeDatabaseTargetError` | El guardián bloqueó la operación: **no** forzar; revisar el mensaje. |

## 6. Evidencia que debe guardar el compañero

1. Salida **completa** de `npm run test:integration --workspace=@g10-m8/backend` (captura o `.txt`), con
   el resumen `Test Suites: 2 passed` y el total de tests.
2. Salida de `npm test --workspace=@g10-m8/backend` (unitarias, sin Docker).
3. `docker version` y `docker ps -a` **antes y después** (sin contenedores residuales).
4. Versión de Node (`node -v`), commit (`git rev-parse --short HEAD`) y sistema operativo.
5. (Opcional) Salida con `DEBUG=testcontainers*` que muestre puerto dinámico y creación/eliminación del contenedor.
6. Si algún test falla: log completo y **no** modificar las pruebas para que pasen; reportarlo al equipo.

## 7. Estado de verificación

| Verificación | Estado |
| --- | --- |
| Compilación (`nest build`) y tipos (`tsc --noEmit`) incluyendo los archivos de integración | Realizado localmente (sin Docker). |
| Pruebas unitarias (incluye las 12 del guardián, sin Docker) | Realizado localmente: 17 suites, 118 pruebas aprobadas (`--runInBand`). |
| Las suites de integración se listan con su configuración y están excluidas de `npm test` | Realizado localmente (`jest --listTests`). |
| **Ejecución de las pruebas de integración con Docker** | **PENDIENTE** (PC del compañero). |
| Aplicación real de la migración sobre PostgreSQL 16 | **PENDIENTE** (ocurre en el `globalSetup`). |
| Prueba SMTP con PDF adjunto | **PENDIENTE** (fuera de esta suite). |
