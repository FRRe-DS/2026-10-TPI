import {
  assertOpaqueQrPayload,
  maskAmount,
  maskEmail,
  maskQrToken,
  maskSensitiveText,
  sanitizeTripIdForQrToken,
} from './privacy-masking.util';

describe('privacy-masking.util (RNF-19 Privacidad y Enmascaramiento)', () => {
  describe('maskEmail', () => {
    it('debe enmascarar la parte local del correo electrónico en logs', () => {
      expect(maskEmail('juan.perez@ejemplo.com')).toBe('j***z@ejemplo.com');
      expect(maskEmail('ab@dominio.ar')).toBe('a***@dominio.ar');
      expect(maskEmail('')).toBe('***');
      expect(maskEmail(undefined)).toBe('***');
    });
  });

  describe('maskAmount', () => {
    it('debe ocultar el importe numérico exacto conservando solo la moneda', () => {
      expect(maskAmount(4500.75, 'ARS')).toBe('ARS ***.**');
      expect(maskAmount('12000', 'USD')).toBe('USD ***.**');
    });
  });

  describe('maskQrToken', () => {
    it('debe ocultar el cuerpo del token QR dejando únicamente los últimos 4 caracteres', () => {
      expect(maskQrToken('qr_trip-123_0123456789abcdef0123456789abcdef')).toBe('qr_***_cdef');
      expect(maskQrToken('')).toBe('qr_***');
    });
  });

  describe('maskSensitiveText', () => {
    it('debe enmascarar emails, tarjetas de crédito (PAN) y DNI dentro de cadenas de log', () => {
      const rawLog =
        'Usuario luca@correo.com con DNI 42123456 pagó con tarjeta 4509 1234 5678 9010';
      const masked = maskSensitiveText(rawLog);

      expect(masked).not.toContain('luca@correo.com');
      expect(masked).toContain('l***a@correo.com');
      expect(masked).not.toContain('42123456');
      expect(masked).toContain('[DNI-ENMASCARADO]');
      expect(masked).not.toContain('4509 1234 5678 9010');
      expect(masked).toContain('[TARJETA-ENMASCARADA]');
    });
  });

  describe('sanitizeTripIdForQrToken & assertOpaqueQrPayload', () => {
    it('debe aceptar un token opaco criptográfico válido sin datos personales', () => {
      const validToken = 'qr_trip-12345_0123456789abcdef0123456789abcdef';
      expect(() =>
        assertOpaqueQrPayload(validToken, ['usr-passenger-99', 'juan@test.com', '40111222']),
      ).not.toThrow();
    });

    it('debe rechazar payloads QR que contengan JSON, URLs o datos personales del pasajero', () => {
      expect(() =>
        assertOpaqueQrPayload('{"token":"qr_1","passengerId":"usr-1","dni":"40111222"}'),
      ).toThrow(/RNF-19/);

      expect(() =>
        assertOpaqueQrPayload('https://api.m8.local/qr?dni=40111222&email=a@b.com'),
      ).toThrow(/RNF-19/);

      expect(() =>
        assertOpaqueQrPayload(
          'qr_usr-secret-999_0123456789abcdef0123456789abcdef',
          ['usr-secret-999'],
        ),
      ).toThrow(/RNF-19/);
    });

    it('debe sanitizar cualquier DNI o email si viniera accidentalmente en el tripId', () => {
      const dirtyTripId = 'trip-40123456-user@mail.com';
      const clean = sanitizeTripIdForQrToken(dirtyTripId);
      expect(clean).not.toContain('40123456');
      expect(clean).not.toContain('@');
    });
  });
});
