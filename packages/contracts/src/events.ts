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

export interface ReservationReminderPayload {
  reservationId: string;
  passengerId: string;
  passengerEmail: string;
  scheduledPickupTime: string;
  minutesUntilPickup: number;
}

export type ReservationReminderEvent = BaseDomainEvent<ReservationReminderPayload>;
