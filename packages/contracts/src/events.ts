/**
 * Contratos de Eventos Asíncronos para M8 (Notificaciones, Documentos y Soporte)
 * Cumple con RNF-03 y RF-8.8
 */

export interface BaseDomainEvent<T = any> {
  eventId: string;
  eventType: string;
  timestamp: string;
  version: string;
  data: T;
}

export type EventoOrigen = 'M5' | 'M6' | 'M7' | 'M9';

export type EventoTipo =
  | 'VIAJE_SOLICITADO'
  | 'VIAJE_ASIGNADO'
  | 'VIAJE_ARRIBO_CONDUCTOR'
  | 'VIAJE_INICIADO'
  | 'VIAJE_CANCELADO'
  | 'VIAJE_FINALIZADO'
  | 'RESERVA_CREADA'
  | 'RESERVA_MODIFICADA'
  | 'RESERVA_CONFIRMADA'
  | 'RESERVA_RECORDATORIO'
  | 'RESERVA_ACTIVADA'
  | 'RESERVA_CANCELADA'
  | 'RESERVA_VENCIDA'
  | 'PAGO_CAPTURADO'
  | 'REINTEGRO_REGISTRADO';

export interface EventoEntradaDestinatario {
  usuarioId: string;
  rol: 'CLIENTE' | 'CONDUCTOR';
  email?: string;
  telefono?: string;
  canalesPreferidos?: Array<'EMAIL' | 'SMS' | 'PUSH'>;
}

export interface EventoEntradaDetalle {
  origen?: string;
  destino?: string;
  fechaProgramada?: string;
  zonaHoraria?: string;
  tipoVehiculo?: 'AUTO' | 'MOTO';
  motivo?: string;
  importe?: {
    monto: number;
    moneda: string;
  };
}

export interface EventoEntrada {
  eventoId: string;
  tipo: EventoTipo;
  origen: EventoOrigen;
  ocurridoEn: string;
  viajeId?: string;
  reservaId?: string;
  pagoId?: string;
  destinatarios: EventoEntradaDestinatario[];
  detalle?: EventoEntradaDetalle;
}

// -------------------------------------------------------------
// Eventos de M6: Viajes y Ciclo de Vida
// -------------------------------------------------------------
export interface TripCompletedPayload {
  tripId: string;
  passengerId: string;
  passengerEmail: string;
  passengerPhone?: string;
  driverId: string;
  driverName?: string;
  totalFare: number;
  currency: string;
  origin: string;
  destination: string;
  completedAt: string;
}

export type TripCompletedEvent = BaseDomainEvent<TripCompletedPayload>;

export interface TripAssignedPayload {
  tripId: string;
  passengerId: string;
  passengerEmail: string;
  driverId: string;
  driverName: string;
  vehicleModel: string;
  vehiclePlate: string;
  estimatedArrivalMinutes: number;
}

export type TripAssignedEvent = BaseDomainEvent<TripAssignedPayload>;

export interface DriverArrivedPayload {
  tripId: string;
  passengerId: string;
  passengerEmail: string;
  pickupLocation: string;
  arrivedAt: string;
}

export type DriverArrivedEvent = BaseDomainEvent<DriverArrivedPayload>;

export interface TripCancelledPayload {
  tripId: string;
  passengerId: string;
  passengerEmail: string;
  cancelledBy: 'PASSENGER' | 'DRIVER' | 'SYSTEM';
  reason?: string;
  cancellationFee?: number;
}

export type TripCancelledEvent = BaseDomainEvent<TripCancelledPayload>;

// -------------------------------------------------------------
// Eventos de M7: Tarifas, Pagos y Liquidaciones
// -------------------------------------------------------------
export interface PaymentCapturedPayload {
  paymentId: string;
  tripId?: string;
  reservationId?: string;
  userId: string;
  userEmail: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  capturedAt: string;
}

export type PaymentCapturedEvent = BaseDomainEvent<PaymentCapturedPayload>;

// -------------------------------------------------------------
// Eventos de M9: Reservas de Viajes
// -------------------------------------------------------------
export interface ReservationConfirmedPayload {
  reservationId: string;
  passengerId: string;
  passengerEmail: string;
  scheduledPickupTime: string;
  origin: string;
  destination: string;
  vehicleType: string;
  estimatedFare: number;
}

export type ReservationConfirmedEvent = BaseDomainEvent<ReservationConfirmedPayload>;

export interface ReservationCreatedPayload {
  reservationId: string;
  passengerId: string;
  passengerEmail: string;
  scheduledPickupTime?: string;
  origin?: string;
  destination?: string;
  vehicleType?: string;
  estimatedFare?: number;
  currency?: string;
}

export type ReservationCreatedEvent = BaseDomainEvent<ReservationCreatedPayload>;

export interface ReservationReminderPayload {
  reservationId: string;
  passengerId: string;
  passengerEmail: string;
  scheduledPickupTime: string;
  minutesUntilPickup: number;
}

export type ReservationReminderEvent = BaseDomainEvent<ReservationReminderPayload>;
