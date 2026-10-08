---
name: mock-event-runner
description: Guía y scripts para simular y publicar eventos de RabbitMQ imitando a los módulos M5 (Despacho), M6 (Viajes), M7 (Pagos) y M9 (Reservas) hacia M8.
---

# Skill: Emulador de Eventos de la Plataforma

Esta skill permite a los desarrolladores de M8 probar flujos asíncronos completos (recepción de eventos, envío de notificaciones y generación de PDFs) sin depender de que los otros 8 grupos de la cátedra tengan sus sistemas levantados.

## Eventos Soportados y Rutas de Publicación

### 1. Simulación vía REST (Módulo Simulador de M8)
El backend cuenta con endpoints internos en `/api/v1/simulator/events` para disparar eventos rápidamente:
- `POST /api/v1/simulator/trip-completed`: Emite un evento de viaje finalizado (dispara generación de comprobante PDF y notificación).
- `POST /api/v1/simulator/reservation-confirmed`: Emite confirmación de reserva (dispara notificación y programación de recordatorio).
- `POST /api/v1/simulator/payment-captured`: Emite pago exitoso (dispara comprobante).

### 2. Formato Estándar de Payloads de Eventos
Los payloads deben respetar las interfaces definidas en `packages/contracts/src/events.ts`:

#### Ejemplo de Viaje Finalizado (`trip.completed`):
```json
{
  "eventId": "evt-uuid-1",
  "eventType": "trip.completed",
  "timestamp": "2026-10-08T14:30:00Z",
  "data": {
    "tripId": "trip-8842",
    "passengerId": "user-101",
    "passengerEmail": "cliente@ejemplo.com",
    "passengerPhone": "+5491112345678",
    "driverId": "driver-202",
    "totalFare": 4500.50,
    "currency": "ARS",
    "origin": "Av. Corrientes 1234, CABA",
    "destination": "Aeroparque Jorge Newbery",
    "completedAt": "2026-10-08T14:28:10Z"
  }
}
```

## Verificación de Resultados
- **Emails**: Abrir la interfaz web de Mailpit en `http://localhost:8025` para constatar la recepción del correo formateado.
- **Base de Datos**: Verificar que se insertó el registro en la tabla `NotificationLog` o `DocumentReceipt` con Prisma Studio (`npm run prisma:studio`).
