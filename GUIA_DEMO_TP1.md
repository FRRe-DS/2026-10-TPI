# 📘 Guía Completa de Módulo 8 (M8): Notificaciones, Documentos y Soporte
> **Grupo 10 — Cátedra de Diseño de Sistemas / Ingeniería de Software 2026**  
> *Documento de referencia técnica, explicación conceptual y guía paso a paso para la defensa y demostración del TP1.*

---

## 1. 🚀 ¿Qué es este Repositorio y qué problema resuelve? (Explicación Simple)

Imaginá una plataforma como Uber o Cabify: los viajes ocurren, los conductores conducen y los pagos se cobran. Pero **¿quién le avisa al pasajero que el auto llegó? ¿Quién emite la factura legal para que la empresa no tenga problemas impositivos? ¿Quién valida que el pasajero que sube al auto es realmente quien pidió el viaje? ¿Y quién atiende al cliente si se olvidó una mochila en el auto?**

Ese es el **Módulo 8 (M8)**. Es el centro neurálgico de **comunicación, documentación formal y atención al cliente** de toda la plataforma de movilidad urbana.

Cumple **4 responsabilidades vitales**:
1. **Validación de Abordaje Seguro (RF-8.3 / RNF-08):** Genera códigos QR temporales y únicos con TTL en Redis para que el chofer y el pasajero validen el inicio del viaje sin riesgo de fraude.
2. **Facturación y Comprobantes en PDF Oficial (RF-8.4 / RF-8.5):** Genera automáticamente comprobantes numerados (`REC-2026-XXXXXX`), compila archivos vectoriales en PDF listos para descargar y permite reenviarlos por correo con adjuntos.
3. **Notificaciones y Auditoría Legal (RF-8.1 / RF-8.2 / RF-8.6):** Despacha correos electrónicos y mensajes del sistema, guardando un registro forense (quién lo recibió, a qué hora, estado de entrega y reintentos ante fallas).
4. **Mesa de Ayuda y Reclamos (RF-8.7):** Sistema de tickets de soporte (`TCK-2026-XXXXXX`) con máquina de estados finita para gestionar reclamos asociados a viajes o reservas.

---

## 2. 🏛️ Estructura del Monorepo (¿Dónde está cada cosa?)

El repositorio está estructurado como un **Monorepo moderno con npm workspaces**:

```
G10-M8/
├── apps/
│   ├── backend/             # Microservicio NestJS con Arquitectura Hexagonal
│   │   ├── src/modules/
│   │   │   ├── documents/   # Códigos QR y Comprobantes PDF (RF-8.3, 8.4, 8.5)
│   │   │   ├── notifications/# Envío de emails, auditoría y RabbitMQ (RF-8.1, 8.2, 8.6)
│   │   │   ├── support/     # Tickets de reclamo y máquina de estados (RF-8.7)
│   │   │   └── simulator/   # Simulador de eventos para demostración en clase
│   │   └── prisma/          # Esquema de base de datos sincronizado con Supabase Cloud
│   │
│   └── frontend/            # Backoffice Dashboard interactivo en React + Vite + Tailwind
│       └── src/App.tsx      # Panel visual conectado a los endpoints reales
│
├── packages/
│   └── contracts/           # Contrato formal OpenAPI 3.1 unificado y tipos compartidos
│
├── docker-compose.yml       # Orquestación de infraestructura local (Redis, RabbitMQ, Mailpit, Postgres)
└── .github/workflows/ci.yml # Pipeline de Integración Continua (Lint, Tests, Build, Docker)
```

---

## 3. 🧩 ¿Qué significa que la Arquitectura sea Hexagonal? (Explicado para Mortales)

En las arquitecturas comunes de facultad, la gente suele escribir código en un "Service" que llama directamente a la base de datos con consultas SQL o librerías externas de correo. Si el profesor o el cliente te dice: *"Cambiemos Postgres por Mongo"* o *"Cambiemos Nodemailer por SendGrid"*, tenés que reescribir y romper todo el sistema.

La **Arquitectura Hexagonal (o Puertos y Adaptadores)** soluciona esto aislando el sistema en 3 partes:

```
  [ MUNDO EXTERIOR ]                [ NUESTRO CÓDIGO INTERNO ]
  (HTTP / Postman / React)  ──>  [ Controlador / Puerto Entrada ]
                                           ↓
                                ⭐ [ CASO DE USO / DOMINIO ] ⭐  (Reglas Puras)
                                           ↓
                                [ Puerto Salida (Interface) ]
                                           ↓
  [ ADAPTADORES REALES ]    <──  (Prisma / Redis / Nodemailer)
  (Supabase / Docker / SMTP)
```

* **El Dominio (Reglas Puras):** No tiene dependencias de librerías externas. Dice cosas como: *"Un ticket cerrado no puede modificarse jamás"* o *"Un QR solo puede usarse una única vez"*.
* **Los Puertos (`Ports`):** Son contratos/interfaces TypeScript que dicen lo que el dominio necesita del mundo exterior (ej. `SupportTicketRepositoryPort`, `ReceiptPdfGeneratorPort`).
* **Los Adaptadores (`Adapters`):** Son los enchufes concretos a las tecnologías:
  - `PrismaSupportTicketRepository`: Enchufa el sistema a **Supabase Cloud**.
  - `RedisQrTokenRepository`: Enchufa el consumo atómico de tokens a **Redis 7**.
  - `NodemailerEmailAdapter`: Enchufa la salida de correos al servidor **SMTP**.
  - `PdfKitReceiptPdfAdapter`: Dibuja el comprobante oficial en binario **PDF**.

**¿La ventaja?** Podés cambiar cualquier base de datos o proveedor externo sin tocar una sola línea de la lógica del negocio.

---

## 4. 🔌 ¿Cómo se comunican los otros Módulos con M8?

M8 se conecta con los otros módulos del sistema de movilidad mediante **dos vías**:

### A. Vía Asíncrona (Eventos RabbitMQ - Desacoplada)
No requiere que los módulos se conozcan ni esperen respuesta:
1. El **Módulo 6 (Viajes)** finaliza un viaje y publica un evento en el Exchange `urban_mobility_events` con clave `trip.completed`.
2. El **Módulo 9 (Reservas)** confirma una reserva y publica `reservation.confirmed`.
3. M8 tiene un **Consumidor RabbitMQ** (`TripCompletedConsumer`) escuchando la cola `m8_notifications_queue`. Cuando llega el mensaje, M8 emite el comprobante, dibuja el PDF y manda el correo automáticamente. Si M8 se apagara, los mensajes quedan guardados en la cola y se procesan al volver.

### B. Vía Síncrona (API REST con Contratos OpenAPI 3.1)
Para acciones que requieren respuesta inmediata en milisegundos:
* **La app del conductor** consulta `POST /api/v1/documents/qr/verify` antes de arrancar.
* **La app del pasajero** consulta `GET /api/v1/documents/receipts/:tripId/download` para guardar el PDF.
* **El módulo de administración** consulta `GET /api/v1/support/tickets` para ver los reclamos.

---

## 5. 🌐 ¿Por qué todo es Real y no simulado?

* **Los correos electrónicos:** Son reales. El backend abre una conexión de socket TCP al puerto `1025` de **Mailpit** (servidor SMTP en Docker). Construye paquetes MIME reales con el PDF binario adjunto codificado en Base64.
* **La Base de Datos:** Los tickets y logs de notificaciones viajan cifrados por internet a **Supabase Cloud** (PostgreSQL real en la nube).
* **El QR y Redis:** Utiliza un motor **Redis 7** real con la instrucción `GETDEL` para garantizar consumo atómico (evitando que dos choferes arranquen con el mismo código).
* **Las Pruebas Automatizadas:** Contamos con **106 tests reales en Jest** (100% pasando) cubriendo cada caso de uso, reintentos SMTP, fallos y concurrencia.

---

---

# 🎯 PLAN DETALLADO PASO A PASO PARA PROBAR Y MOSTRAR TODO EN LA CLASE

Seguí este plan al pie de la letra para que la demostración salga perfecta.

---

### ⏱️ FASE 0: Puesta en Marcha (Antes de que empiece la clase)

1. **Abrí una terminal en la raíz del proyecto y levantá Docker:**
   ```bash
   docker compose up -d
   docker compose ps
   ```
   *(Verificá que los 4 contenedores digan `healthy`: Postgres, Redis, RabbitMQ y Mailpit).*

2. **Compilá y levantá el backend:**
   ```bash
   npm run build
   node apps/backend/dist/main.js
   ```
   *(Verás en la consola: `Servidor M8 iniciado en puerto 3000` y `Escuchando urban_mobility_events`).*

3. **En otra pestaña de la terminal, levantá el frontend:**
   ```bash
   npm run dev --workspace=apps/frontend
   ```
   *(Verás: `VITE ready in ... Local: http://localhost:5173/`).*

4. **Abrí 4 pestañas en tu navegador (en este orden exacto):**
   - **Pestaña 1 (Tu Panel Visual):** [http://localhost:5173](http://localhost:5173)
   - **Pestaña 2 (Bandeja de Correos Mailpit):** [http://localhost:8025](http://localhost:8025)
   - **Pestaña 3 (Contratos Swagger OpenAPI):** [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
   - **Pestaña 4 (RabbitMQ Management):** [http://localhost:15672](http://localhost:15672) *(usuario: `guest`, clave: `guest`)*

---

### 🎤 FASE 1: Demostración en Vivo en la Clase (5 Minutos)

#### 1. Introducción Rápida (30 segundos)
> *"Buenas tardes. Somos el Grupo 10 y desarrollamos el **Módulo 8: Notificaciones, Documentos y Soporte**. Nuestro microservicio fue construido bajo **Arquitectura Hexagonal**, desacoplando el dominio de la infraestructura: persistencia en **PostgreSQL Supabase Cloud**, estado efímero y atómico en **Redis**, mensajería asíncrona con **RabbitMQ**, y generación de comprobantes PDF con despacho SMTP."*

---

#### 2. Demostración de Códigos QR de Abordaje Seguro (RF-8.3 / RNF-08) (1 minuto)
1. En la Pestaña 1 (Dashboard), hacé clic en el menú lateral: **"Verificación QR (RF-8.3)"**.
2. Dejá el tripId que viene sugerido o poné uno nuevo y hacé clic en el botón azul **"Generar Código QR"**:
   - *Explicá:* *"Acá se genera un token criptográfico único con 300 segundos de TTL guardado en Redis y respaldado en PostgreSQL, renderizando la imagen del QR para el pasajero."*
3. En la tarjeta de la derecha ("Escanear y Consumir QR"), hacé clic en **"Verificar y Quemar Token"**:
   - Aparece la tarjeta verde: **`200 OK` - Verificación Exitosa**.
   - *Explicá:* *"El chofer escaneó el código. El backend ejecutó una verificación atómica con `redis.getDel()`, habilitando el inicio de viaje."*
4. **Hacé clic OTRA VEZ de inmediato en "Verificar y Quemar Token":**
   - Aparece la tarjeta roja: **`410 Gone` - El código QR ya fue utilizado anteriormente**.
   - *Explicá:* *"Cumplimos con el RNF-08: es un código de un solo uso. Aunque intenten reutilizarlo o capturar la pantalla, el token fue destruido y no puede iniciarse dos veces."*

---

#### 3. Demostración de Comprobantes Oficiales y Descarga de PDF (RF-8.4 / RF-8.5) (1.5 minutos)
1. En el menú lateral, hacé clic en **"Comprobantes PDF (RF-8.4, 8.5)"**.
2. En la tarjeta izquierda, hacé clic en **"Emitir Comprobante (POST)"**:
   - Muestra el comprobante registrado con código `REC-2026-XXXXXX` en Supabase.
   - *Explicá:* *"La emisión es idempotente: si el viaje ya tuviera un comprobante emitido, no duplica cobros ni registros, devuelve el existente."*
3. En la tarjeta superior derecha, hacé clic en el botón **"Descargar PDF"**:
   - Se abrirá o descargará inmediatamente el archivo `comprobante-REC-2026-XXXXXX.pdf`.
   - **Abrí el archivo PDF en vivo ante los profesores**: mostrá el logo, el número oficial de comprobante, la fecha original, los datos del pasajero, chofer y desglose de tarifas.
   - *Explicá:* *"El PDF se compila bajo demanda con PDFKit vectorial en memoria en menos de 20 milisegundos."*
4. En la tarjeta inferior derecha ("Reenviar Comprobante"), poné un correo cualquiera y hacé clic en **"Reenviar Comprobante por Email"**:
   - Responde exitoso en verde.
   - **Cambiá a la Pestaña 2 (Mailpit):** Mostrá cómo entró el nuevo correo en la bandeja y abrí el mensaje para que vean el archivo PDF adjunto.

---

#### 4. Demostración de Tickets de Soporte y Máquina de Estados (RF-8.7) (1 minuto)
1. En el menú lateral, hacé clic en **"Soporte & Tickets (RF-8.7)"**.
2. Mostrá la tabla: *estos tickets están alojados físicamente en **Supabase Cloud**.*
3. Completá el formulario lateral con un reclamo de prueba (ej: *"Cobro indebido de peaje"*) y hacé clic en **"Abrir Ticket en Supabase"**:
   - Se crea con numeración no colisionable `TCK-2026-XXXXXX` y estado `OPEN`.
4. Mostrá la **Máquina de Estados Hexagonal**:
   - En la fila del nuevo ticket, hacé clic en **"Iniciar →"** (pasa a `IN_PROGRESS`).
   - Hacé clic en **"Resolver ✓"** (pasa a `RESOLVED`).
   - Hacé clic en **"Cerrar"** (pasa a `CLOSED`, estado final terminal).
   - *Explicá:* *"La lógica de dominio prohíbe saltos de estado inválidos o mutar un ticket cerrado."*

---

#### 5. Demostración de Eventos Asíncronos RabbitMQ y Notificaciones (1 minuto)
1. En el menú lateral, hacé clic en **"Simulador de Eventos"**.
2. Hacé clic en **"Disparar trip.completed (M6)"**:
   - En la consola inferior verás cómo el evento es atrapado, emite comprobante y envía el correo.
3. Hacé clic en **"Disparar reservation.confirmed (M9)"**:
   - Simula la confirmación de viaje programado.
4. Andá a la pestaña **"Notificaciones (RF-8.1, 8.6)"**:
   - Mostrá la tabla de auditoría en Supabase con los canales (`EMAIL`), estados (`SENT`), y cantidad de reintentos.
5. Andá a **Mailpit** y mostrá los nuevos correos entrantes.

---

### 💻 FASE 2: Demostración Técnica para el Profesor Exigente (Por Terminal)

Si un profesor te dice: *"No me muestres el frontend, mostrame la terminal o haceme una petición por consola"*:

1. **Correr las pruebas unitarias e integración en vivo:**
   ```bash
   npm run test
   ```
   *(Mostrará: **16 Test Suites passed, 106 tests passed, 100% éxito**).*

2. **Probar el QR por cURL:**
   ```bash
   # Generar QR
   curl -s -X POST http://localhost:3000/api/v1/documents/qr/generate \
     -H "Content-Type: application/json" \
     -d '{"tripId":"viaje-terminal-1","passengerId":"pax-1","ttlSeconds":300}' | jq .

   # Verificar 1er intento (devolverá 200 OK)
   curl -s -i -X POST http://localhost:3000/api/v1/documents/qr/verify \
     -H "Content-Type: application/json" \
     -d '{"token":"<COPIAR_TOKEN_ANTERIOR>","tripId":"viaje-terminal-1"}' | head -n 12

   # Verificar 2do intento (devolverá 410 Gone)
   curl -s -i -X POST http://localhost:3000/api/v1/documents/qr/verify \
     -H "Content-Type: application/json" \
     -d '{"token":"<COPIAR_TOKEN_ANTERIOR>","tripId":"viaje-terminal-1"}' | head -n 12
   ```

3. **Descargar el comprobante binario PDF directamente:**
   ```bash
   curl -s http://localhost:3000/api/v1/documents/receipts/trip-class-demo-01/download -o comprobante_test.pdf
   ls -la comprobante_test.pdf
   ```

---

### 🛡️ FASE 3: Respuestas a Preguntas Trampa Típicas

* **P: "¿Por qué no usan Gmail para mandar los correos?"**
  - **R:** *"En ambientes de desarrollo y testing empresariales se utilizan servidores SMTP sandbox como Mailpit. Usar Gmail provocaría que la IP sea bloqueada por spam ante ráfagas de pruebas, expondría credenciales reales en repositorios y violaría las buenas prácticas de CI/CD."*

* **P: "¿Qué pasa si dos personas escanean el mismo QR al mismo milisegundo?"**
  - **R:** *"Está protegido por diseño con `redis.getDel()` atómico (RNF-08). Redis procesa comandos en un solo hilo de ejecución de forma secuencial; la primera lectura obtiene y elimina la clave simultáneamente, y la segunda solicitud lee `null`, siendo rechazada con 410 Gone."*

* **P: "¿Qué pasa si se cae el servidor de correos cuando finaliza un viaje?"**
  - **R:** *"El caso de uso `SendNotificationUseCase` cuenta con política de 3 reintentos automáticos con backoff. Si aún así el servidor no responde, el evento no se descarta: se registra en `NotificationLog` con estado `FAILED` y el mensaje de error para reintento posterior, garantizando trazabilidad y auditoría (RF-8.6)."*

* **P: "¿Qué pasa si el módulo de viajes envía 2 veces el mismo evento de fin de viaje?"**
  - **R:** *"El registro de comprobantes (`RegisterReceiptUseCase`) es completamente idempotente por `tripId`. Si detecta que ya existe un comprobante para ese viaje, devuelve el registro existente sin duplicar el cobro ni crear registros huérfanos en la base de datos."*

* **P: "¿Dónde están los contratos entre módulos?"**
  - **R:** *"Están definidos formalmente en OpenAPI 3.1 en `packages/contracts/openapi.yaml` y documentados interactivamente con Swagger en `/api/docs`."*
