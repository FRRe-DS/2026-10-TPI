/**
 * Utilidades de privacidad y enmascaramiento de datos sensibles (RNF-19)
 *
 * Reglas de privacidad del Módulo 8:
 * 1. Ningún código QR debe contener datos personales (DNI, tarjetas, correos, direcciones
 *    privadas ni passengerId). El QR solo codifica un token opaco criptográfico.
 * 2. Los logs de consola deben enmascarar correos electrónicos, montos financieros,
 *    tokens opacos, números de tarjeta y DNI.
 */

const EMAIL_REGEX = /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
const CARD_PAN_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;
const DNI_REGEX = /\b\d{7,8}\b/g;
const OPAQUE_QR_TOKEN_REGEX = /^qr_[A-Za-z0-9_-]+_[0-9a-f]{32}$/;

/**
 * Enmascara una dirección de correo electrónico para logs de consola (ej. "p***o@ejemplo.com").
 */
export function maskEmail(email?: string | null): string {
  if (!email || typeof email !== 'string') {
    return '***';
  }
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return '***';
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (local.length <= 2) {
    return `${local[0] ?? '*'}***@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

/**
 * Enmascara un monto monetario para evitar exponer importes en logs de consola.
 */
export function maskAmount(_amount?: number | string | null, currency = 'ARS'): string {
  const curr = currency?.trim() || 'ARS';
  return `${curr} ***.**`;
}

/**
 * Enmascara un token opaco de QR en logs de consola conservando solo los últimos 4 caracteres hex.
 */
export function maskQrToken(token?: string | null): string {
  if (!token || typeof token !== 'string') {
    return 'qr_***';
  }
  const trimmed = token.trim();
  const suffix = trimmed.length >= 4 ? trimmed.slice(-4) : '****';
  return `qr_***_${suffix}`;
}

/**
 * Enmascara correos, números de tarjeta (PAN 13-19 dígitos) y DNI (7-8 dígitos) en textos de log.
 */
export function maskSensitiveText(text?: string | null): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text
    .replace(EMAIL_REGEX, (full) => maskEmail(full))
    .replace(CARD_PAN_REGEX, '[TARJETA-ENMASCARADA]')
    .replace(DNI_REGEX, '[DNI-ENMASCARADO]');
}

/**
 * Sanitiza el identificador de viaje antes de construir el prefijo del token QR,
 * eliminando cualquier correo, número de tarjeta, DNI o caracteres no permitidos en URLs/tokens.
 */
export function sanitizeTripIdForQrToken(tripId: string): string {
  const cleaned = maskSensitiveText(tripId)
    .replace(/\[(?:TARJETA|DNI)-ENMASCARADO\]/g, 'redacted')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'trip';
}

/**
 * Valida que el contenido codificado dentro de la imagen QR sea exclusivamente un token
 * opaco criptográfico y no exponga JSON, URLs con datos personales, correos, DNI, tarjetas
 * ni el identificador personal del pasajero (RNF-19).
 */
export function assertOpaqueQrPayload(
  qrPayload: string,
  forbiddenPersonalValues: (string | undefined | null)[] = [],
): void {
  if (!qrPayload || typeof qrPayload !== 'string') {
    throw new Error('RNF-19: El payload del QR debe ser un token opaco no vacío.');
  }

  const trimmed = qrPayload.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.includes('://')) {
    throw new Error(
      'RNF-19: El código QR no puede contener objetos JSON ni URLs; solo el token opaco.',
    );
  }

  if (!OPAQUE_QR_TOKEN_REGEX.test(trimmed)) {
    throw new Error(
      'RNF-19: El código QR solo debe contener un token opaco criptográfico con formato válido.',
    );
  }

  if (EMAIL_REGEX.test(trimmed) || CARD_PAN_REGEX.test(trimmed)) {
    EMAIL_REGEX.lastIndex = 0;
    CARD_PAN_REGEX.lastIndex = 0;
    throw new Error('RNF-19: El token QR contiene patrones de datos sensibles prohibidos.');
  }
  EMAIL_REGEX.lastIndex = 0;
  CARD_PAN_REGEX.lastIndex = 0;

  for (const personalValue of forbiddenPersonalValues) {
    const cleanVal = personalValue?.trim();
    if (cleanVal && cleanVal.length >= 3 && trimmed.includes(cleanVal)) {
      throw new Error(
        'RNF-19: El token QR no debe incluir datos personales del pasajero en su payload.',
      );
    }
  }
}
