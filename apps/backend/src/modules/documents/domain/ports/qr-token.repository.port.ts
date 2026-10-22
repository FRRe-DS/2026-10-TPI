/**
 * Puerto de salida: Repositorio de Tokens de Verificación QR (RF-8.3, RNF-02, RNF-08)
 * Dominio puro – desacoplado de Prisma, Supabase o cualquier persistencia concreta.
 */

export interface QrTokenData {
  token: string;
  tripId: string;
  passengerId: string;
  expiresAt: Date;
  isUsed?: boolean;
}

export interface QrTokenRecord {
  id: string;
  token: string;
  tripId: string;
  passengerId: string;
  isUsed: boolean;
  usedAt?: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface QrTokenRepositoryPort {
  /**
   * Persiste un nuevo token de verificación QR.
   */
  save(data: QrTokenData): Promise<QrTokenRecord>;

  /**
   * Busca un token por su identificador único. Devuelve null si no existe.
   */
  findByToken(token: string): Promise<QrTokenRecord | null>;

  /**
   * Marca atómicamente el token como usado (isUsed = true, usedAt = timestamp)
   * únicamente si el registro se encuentra actualmente sin usar (isUsed = false).
   * Devuelve true si la actualización fue exitosa, o false si ya había sido consumido
   * por otra solicitud concurrente (garantía RNF-08).
   */
  markAsUsed(token: string, usedAt?: Date): Promise<boolean>;
}

export const QR_TOKEN_REPOSITORY_PORT = Symbol('QR_TOKEN_REPOSITORY_PORT');
