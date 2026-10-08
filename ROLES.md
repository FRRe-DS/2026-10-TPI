# Asignación de Roles y Células de Trabajo (9 Integrantes)

Para coordinar el trabajo en equipo de forma ordenada y sin bloqueos, entre los 9 integrantes nos distribuimos en **4 Células de 2 personas** y **1 Tech Lead / DevOps / QA Cross**. Cada pareja practica **Pair Programming** y actúa como **Revisor principal (Code Reviewer)** mutuo en los Pull Requests.

---

## Matriz de Distribución

### Célula 1: Notificaciones & Asincronismo (2 Integrantes)
- **Integrantes**: Dev 1 & Dev 2
- **Requerimientos**: **RF-8.1, RF-8.2, RF-8.6, RF-8.8**
- **Responsabilidades**:
  1. Configuración de consumidores de eventos de RabbitMQ (`amqplib` / microservicio NestJS).
  2. Implementación del motor de envío multicanal (Email vía Nodemailer/Mailpit, Push simulado).
  3. Registro y trazabilidad de envíos en la tabla `NotificationLog` (RF-8.6).
  4. Lógica de reintentos con backoff exponencial ante fallos transitorios.

---

### Célula 2: Documentos & Seguridad (QR & PDF) (2 Integrantes)
- **Integrantes**: Dev 3 & Dev 4
- **Requerimientos**: **RF-8.3, RF-8.4, RF-8.5**
- **Responsabilidades**:
  1. Generación de códigos QR temporales de un solo uso con expiración en Redis (TTL 300s).
  2. Endpoint de verificación y consumo atómico del QR (RF-8.3 / RF-6.4).
  3. Generador de comprobantes de pago y viaje en formato PDF (`PDFKit`) con layout oficial.
  4. Endpoint de reenvío de comprobantes por correo (RF-8.5) y almacenamiento opcional en Supabase Storage.

---

### Célula 3: Soporte & Tickets (2 Integrantes)
- **Integrantes**: Dev 5 & Dev 6
- **Requerimientos**: **RF-8.7**
- **Responsabilidades**:
  1. Modelo de datos y repositorio para `SupportTicket` y `TicketMessage`.
  2. Endpoints REST para creación de tickets vinculados a viajes, reservas o pagos.
  3. Transiciones de estado de tickets (`OPEN` -> `IN_PROGRESS` -> `RESOLVED` -> `CLOSED`).
  4. Pruebas unitarias de casos de uso y validaciones de negocio.

---

### Célula 4: Frontend Backoffice & Usabilidad (2 Integrantes)
- **Integrantes**: Dev 7 & Dev 8
- **Requerimientos**: **RNF-15, Operaciones de M8**
- **Responsabilidades**:
  1. Desarrollo del Dashboard Web de operadores en `apps/frontend` (React + Vite).
  2. Vistas de gestión y resolución de Tickets de Soporte con filtrado en tiempo real.
  3. Interfaz visual para probar el escaneo y verificación de códigos QR.
  4. Panel para disparar simulaciones de eventos en vivo durante las presentaciones a la cátedra.

---

### Rol Transversal: Tech Lead, DevOps & QA Cross (1 Integrante)
- **Integrante**: Heber (Tech Lead / Coordinador)
- **Requerimientos**: **RNF-01 a RNF-07, RNF-17, RNF-20**
- **Responsabilidades**:
  1. Mantenimiento del Monorepo con `npm workspaces` y sincronización del contrato `openapi.yaml`.
  2. Infraestructura Docker Compose (Postgres, Redis, RabbitMQ, Mailpit) y conexión con Supabase.
  3. Pipeline de Integración Continua (CI) en GitHub Actions (`.github/workflows/ci.yml`).
  4. Módulo simulador de eventos de la plataforma para desbloquear al equipo de pruebas locales.
  5. Asistencia y aprobación en Code Reviews de integración hacia `develop` y `main`.
