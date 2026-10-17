/**
 * Puerto de salida: Repositorio de Comprobantes de Viaje
 * Dominio puro – sin dependencias de infraestructura (RF-8.4, RF-8.5)
 */

export interface ReceiptData {
  tripId: string;
  passengerId: string;
  passengerEmail: string;
  amount: number;
  currency: string;
  driverName?: string;
  /** Metadatos adicionales del viaje (origen, destino, etc.) */
  metadata?: Record<string, unknown>;
}

export interface ReceiptRecord {
  id: string;
  receiptCode: string;
  tripId: string;
  passengerId: string;
  passengerEmail: string;
  amount: number;
  currency: string;
  driverName?: string;
  metadata?: Record<string, unknown>;
  /** Fecha de emisión original – se conserva en re-descargas */
  issuedAt: Date;
}

export interface ReceiptRepositoryPort {
  /**
   * Persiste el comprobante. Si ya existe un registro para el tripId
   * devuelve el existente sin crear duplicado (idempotente).
   */
  save(data: ReceiptData): Promise<ReceiptRecord>;

  /** Busca por tripId. Devuelve null si no existe. */
  findByTripId(tripId: string): Promise<ReceiptRecord | null>;
}

export const RECEIPT_REPOSITORY_PORT = Symbol('RECEIPT_REPOSITORY_PORT');

