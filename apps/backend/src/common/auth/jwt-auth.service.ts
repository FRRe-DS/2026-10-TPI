import { Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { AuthenticatedIdentity, CONTRACT_ROLES, JwtAuthConfig } from './auth.types';
import { DevTokenProviderService } from './dev-token-provider.service';

const SUPPORTED_ASYMMETRIC_ALGORITHMS = new Set<jwt.Algorithm>([
  'RS256',
  'RS384',
  'RS512',
  'ES256',
  'ES384',
  'ES512',
  'PS256',
  'PS384',
  'PS512',
]);

const DEFAULT_ALGORITHMS: jwt.Algorithm[] = ['RS256', 'RS384', 'RS512', 'ES256'];
const DEFAULT_KEYCLOAK_CLIENT_IDS = ['m8-notificaciones'];

function parseCsvList(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeAlgorithms(raw?: string): jwt.Algorithm[] {
  const requested = parseCsvList(raw);
  if (requested.length === 0) {
    return [...DEFAULT_ALGORITHMS];
  }
  const filtered = requested.filter((alg): alg is jwt.Algorithm =>
    SUPPORTED_ASYMMETRIC_ALGORITHMS.has(alg as jwt.Algorithm),
  );
  return filtered.length > 0 ? filtered : [...DEFAULT_ALGORITHMS];
}

function toIssuerOption(values: string[]): string | [string, ...string[]] | undefined {
  if (values.length === 0) return undefined;
  if (values.length === 1) return values[0];
  return [values[0], ...values.slice(1)];
}

function toAudienceOption(values: string[]): string | [string, ...string[]] | undefined {
  if (values.length === 0) return undefined;
  if (values.length === 1) return values[0];
  return [values[0], ...values.slice(1)];
}

/**
 * Extrae y normaliza roles desde un payload JWT YA VERIFICADO criptográficamente.
 * Soporta claims planos del contrato y estructuras anidadas estándar de Keycloak:
 * - role
 * - rol
 * - roles
 * - realm_access.roles
 * - resource_access[clientId].roles (solo para clientIds configurados)
 */
export function extractRolesFromVerifiedPayload(
  payload: Record<string, unknown>,
  configuredClientIds: string[] = DEFAULT_KEYCLOAK_CLIENT_IDS,
): string[] {
  const roleSet = new Set<string>();

  const addRole = (value: unknown) => {
    if (typeof value === 'string') {
      const normalized = value.trim().toUpperCase();
      if (normalized.length > 0) {
        roleSet.add(normalized);
      }
    }
  };

  const addRoleArray = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        addRole(item);
      }
    }
  };

  // Claims planos de primer nivel
  addRole(payload.role);
  addRole(payload.rol);
  addRoleArray(payload.roles);

  // Roles de realm de Keycloak: realm_access.roles
  const realmAccess = payload.realm_access;
  if (realmAccess && typeof realmAccess === 'object') {
    addRoleArray((realmAccess as Record<string, unknown>).roles);
  }

  // Roles de cliente de Keycloak: resource_access[clientId].roles
  const resourceAccess = payload.resource_access;
  if (resourceAccess && typeof resourceAccess === 'object') {
    const resourceMap = resourceAccess as Record<string, unknown>;
    for (const clientId of configuredClientIds) {
      const clientEntry = resourceMap[clientId];
      if (clientEntry && typeof clientEntry === 'object') {
        addRoleArray((clientEntry as Record<string, unknown>).roles);
      }
    }
  }

  return Array.from(roleSet);
}

export function loadJwtAuthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): JwtAuthConfig {
  const issuerValues = parseCsvList(env.AUTH_JWT_ISSUER);
  const audienceValues = parseCsvList(env.AUTH_JWT_AUDIENCE);
  const clientIds = parseCsvList(env.AUTH_KEYCLOAK_CLIENT_IDS || env.AUTH_KEYCLOAK_CLIENT_ID);

  return {
    jwksUri: env.AUTH_JWKS_URI?.trim() || undefined,
    issuer: issuerValues.length <= 1 ? issuerValues[0] : issuerValues,
    audience: audienceValues.length <= 1 ? audienceValues[0] : audienceValues,
    algorithms: sanitizeAlgorithms(env.AUTH_JWT_ALGORITHMS),
    keycloakClientIds: clientIds.length > 0 ? clientIds : [...DEFAULT_KEYCLOAK_CLIENT_IDS],
    jwksCacheMaxAgeMs: parsePositiveNumber(env.AUTH_JWKS_CACHE_MAX_AGE_MS, 600_000),
    jwksTimeoutMs: parsePositiveNumber(env.AUTH_JWKS_TIMEOUT_MS, 5_000),
    clockToleranceSeconds: parsePositiveNumber(env.AUTH_JWT_CLOCK_TOLERANCE_SECONDS, 5),
    nodeEnv: (env.NODE_ENV || 'development').trim().toLowerCase(),
  };
}

/**
 * Servicio central de autenticación JWT con verificación criptográfica real contra JWKS.
 *
 * - Verifica firma asimétrica (RS256/ES256/etc.) con claves públicas obtenidas desde un JWKS
 *   confiable configurado por variables de entorno (nunca usa jku/x5u/jwk del token).
 * - Valida estrictamente exp, nbf (cuando existe), iss y aud.
 * - Rechaza tokens sin firma (alg: none), algoritmos simétricos (HS*) y tokens manipulados.
 * - Nunca registra tokens completos ni secretos en los logs.
 */
@Injectable()
export class JwtAuthService {
  private readonly logger = new Logger(JwtAuthService.name);
  private readonly config: JwtAuthConfig;
  private readonly jwksClient?: JwksClient;

  constructor(
    @Optional() private readonly devTokenProvider?: DevTokenProviderService,
    @Optional() customConfig?: Partial<JwtAuthConfig>,
  ) {
    const envConfig = loadJwtAuthConfigFromEnv();
    this.config = {
      ...envConfig,
      ...customConfig,
      algorithms: customConfig?.algorithms
        ? sanitizeAlgorithms(customConfig.algorithms.join(','))
        : envConfig.algorithms,
      keycloakClientIds:
        customConfig?.keycloakClientIds && customConfig.keycloakClientIds.length > 0
          ? customConfig.keycloakClientIds
          : envConfig.keycloakClientIds,
    };

    if (this.config.jwksUri) {
      this.assertTrustedJwksUri(this.config.jwksUri);
      this.jwksClient = new JwksClient({
        jwksUri: this.config.jwksUri,
        cache: true,
        cacheMaxEntries: 10,
        cacheMaxAge: this.config.jwksCacheMaxAgeMs,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        timeout: this.config.jwksTimeoutMs,
      });
      this.logger.log('Validación JWT configurada con JWKS externo confiable.');
    } else if (this.devTokenProvider?.isEnabled()) {
      this.logger.log(
        'Validación JWT configurada con claves públicas RSA-2048 del proveedor local de desarrollo.',
      );
    } else {
      this.logger.warn(
        'AUTH_JWKS_URI no está configurado y el proveedor local de desarrollo está deshabilitado. ' +
          'Toda solicitud a endpoints protegidos será rechazada (fail-closed).',
      );
    }
  }

  async verifyAuthorizationHeader(authHeader?: string): Promise<AuthenticatedIdentity> {
    if (!authHeader || !authHeader.trim()) {
      throw new UnauthorizedException('Se requiere un token Bearer en el encabezado Authorization.');
    }

    const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
    if (!match || !match[1]) {
      throw new UnauthorizedException('El encabezado Authorization debe utilizar el esquema Bearer.');
    }

    return this.verifyToken(match[1]);
  }

  async verifyToken(token: string): Promise<AuthenticatedIdentity> {
    // 1. Validación estructural básica de JWS (exactamente 3 segmentos con firma no vacía)
    const segments = token.split('.');
    if (segments.length !== 3 || !segments[0] || !segments[1] || !segments[2]) {
      throw new UnauthorizedException('Formato de token JWT inválido.');
    }

    const decoded = jwt.decode(token, { complete: true });
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      !decoded.header ||
      typeof decoded.header !== 'object' ||
      !decoded.payload ||
      typeof decoded.payload !== 'object'
    ) {
      throw new UnauthorizedException('No se pudo decodificar la estructura del token JWT.');
    }

    // 2. Restricción estricta de algoritmo antes de buscar clave (impide alg:none y confusión HS*)
    const alg = decoded.header.alg;
    if (typeof alg !== 'string' || !this.config.algorithms.includes(alg)) {
      this.logger.warn('Token JWT rechazado: algoritmo de firma no permitido.');
      throw new UnauthorizedException('Algoritmo de firma JWT no permitido.');
    }

    const kid = typeof decoded.header.kid === 'string' ? decoded.header.kid.trim() : undefined;

    // 3. Resolución de clave pública y parámetros esperados (iss / aud) desde fuente confiable
    const { signingKey, expectedIssuers, expectedAudiences } =
      await this.resolveVerificationMaterial(kid);

    const verifyOptions: jwt.VerifyOptions = {
      algorithms: this.config.algorithms as jwt.Algorithm[],
      issuer: toIssuerOption(expectedIssuers),
      audience: toAudienceOption(expectedAudiences),
      clockTolerance: this.config.clockToleranceSeconds,
      ignoreExpiration: false,
      ignoreNotBefore: false,
    };

    // 4. Verificación criptográfica real de firma + exp + nbf + iss + aud
    let verifiedPayload: jwt.JwtPayload;
    try {
      const verified = jwt.verify(token, signingKey, verifyOptions);
      if (!verified || typeof verified !== 'object') {
        throw new UnauthorizedException('El payload del token JWT es inválido.');
      }
      verifiedPayload = verified as jwt.JwtPayload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logVerificationFailure(error);
      throw new UnauthorizedException(this.mapJwtErrorMessage(error));
    }

    // 5. Exigir claims esenciales tras verificar la firma
    if (typeof verifiedPayload.exp !== 'number' || !Number.isFinite(verifiedPayload.exp)) {
      this.logger.warn('Token JWT rechazado: falta el claim obligatorio exp.');
      throw new UnauthorizedException('El token JWT debe incluir fecha de expiración (exp).');
    }

    const sub =
      typeof verifiedPayload.sub === 'string' && verifiedPayload.sub.trim()
        ? verifiedPayload.sub.trim()
        : undefined;
    if (!sub) {
      this.logger.warn('Token JWT rechazado: falta el claim obligatorio sub.');
      throw new UnauthorizedException('El token JWT debe incluir un identificador de sujeto (sub).');
    }

    // 6. Extraer roles ÚNICAMENTE del payload ya verificado criptográficamente
    const roles = extractRolesFromVerifiedPayload(
      verifiedPayload as Record<string, unknown>,
      this.config.keycloakClientIds,
    );

    const contractRoleSet = new Set<string>(CONTRACT_ROLES);
    const primaryRole = roles.find((r) => contractRoleSet.has(r)) ?? roles[0];
    const azp =
      typeof verifiedPayload.azp === 'string' && verifiedPayload.azp.trim()
        ? verifiedPayload.azp.trim()
        : undefined;

    return {
      authenticated: true,
      sub,
      roles,
      rol: primaryRole,
      azp,
      iss: typeof verifiedPayload.iss === 'string' ? verifiedPayload.iss : undefined,
      aud: verifiedPayload.aud,
    };
  }

  private async resolveVerificationMaterial(kid?: string): Promise<{
    signingKey: string;
    expectedIssuers: string[];
    expectedAudiences: string[];
  }> {
    // Modo A: JWKS externo configurado (Keycloak / M1)
    if (this.jwksClient) {
      const expectedIssuers = this.normalizeList(this.config.issuer);
      const expectedAudiences = this.normalizeList(this.config.audience);

      if (expectedIssuers.length === 0 || expectedAudiences.length === 0) {
        this.logger.error(
          'Configuración JWT incompleta: con AUTH_JWKS_URI es obligatorio configurar AUTH_JWT_ISSUER y AUTH_JWT_AUDIENCE.',
        );
        throw new UnauthorizedException('La validación JWT no está completamente configurada.');
      }

      if (!kid) {
        this.logger.warn('Token JWT rechazado: falta el encabezado kid para resolución en JWKS.');
        throw new UnauthorizedException('El token JWT debe incluir identificador de clave (kid).');
      }

      try {
        const key = await this.jwksClient.getSigningKey(kid);
        return {
          signingKey: key.getPublicKey(),
          expectedIssuers,
          expectedAudiences,
        };
      } catch {
        this.logger.warn('Token JWT rechazado: no se pudo resolver la clave pública en el JWKS configurado.');
        throw new UnauthorizedException('No se pudo validar la clave de firma del token JWT.');
      }
    }

    // Modo B: Proveedor local efímero (solo desarrollo/pruebas, jamás en producción)
    if (this.devTokenProvider?.isEnabled()) {
      const publicKeyPem = this.devTokenProvider.getPublicKeyPem(kid);
      if (!publicKeyPem) {
        this.logger.warn('Token JWT rechazado: kid desconocido para el proveedor local de desarrollo.');
        throw new UnauthorizedException('Clave de firma del token JWT no reconocida.');
      }
      const expectedIssuers = this.normalizeList(this.config.issuer);
      const expectedAudiences = this.normalizeList(this.config.audience);
      return {
        signingKey: publicKeyPem,
        expectedIssuers:
          expectedIssuers.length > 0 ? expectedIssuers : [this.devTokenProvider.getIssuer()],
        expectedAudiences:
          expectedAudiences.length > 0 ? expectedAudiences : [this.devTokenProvider.getAudience()],
      };
    }

    // Modo C: Fail-closed si no hay proveedor configurado
    this.logger.error('Token JWT rechazado: no hay JWKS configurado para verificar firmas.');
    throw new UnauthorizedException('La autenticación JWT no está configurada en el servidor.');
  }

  private assertTrustedJwksUri(uri: string): void {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw new Error('AUTH_JWKS_URI debe ser una URL válida.');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('AUTH_JWKS_URI debe utilizar protocolo http o https.');
    }
  }

  private normalizeList(value?: string | string[]): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map((v) => v.trim()).filter((v) => v.length > 0);
    }
    return parseCsvList(value);
  }

  private logVerificationFailure(error: unknown): void {
    if (error instanceof jwt.TokenExpiredError) {
      this.logger.warn('Token JWT rechazado: token expirado.');
      return;
    }
    if (error instanceof jwt.NotBeforeError) {
      this.logger.warn('Token JWT rechazado: token aún no vigente (nbf).');
      return;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('issuer')) {
        this.logger.warn('Token JWT rechazado: issuer (iss) inválido.');
      } else if (msg.includes('audience')) {
        this.logger.warn('Token JWT rechazado: audience (aud) inválido.');
      } else if (msg.includes('signature')) {
        this.logger.warn('Token JWT rechazado: firma criptográfica inválida.');
      } else {
        this.logger.warn('Token JWT rechazado: validación criptográfica fallida.');
      }
      return;
    }
    this.logger.warn('Token JWT rechazado por error de verificación.');
  }

  private mapJwtErrorMessage(error: unknown): string {
    if (error instanceof jwt.TokenExpiredError) {
      return 'El token JWT ha expirado.';
    }
    if (error instanceof jwt.NotBeforeError) {
      return 'El token JWT todavía no es válido (nbf).';
    }
    if (error instanceof jwt.JsonWebTokenError) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('issuer')) {
        return 'El emisor (iss) del token JWT no es válido.';
      }
      if (msg.includes('audience')) {
        return 'La audiencia (aud) del token JWT no es válida.';
      }
      if (msg.includes('signature')) {
        return 'La firma del token JWT es inválida.';
      }
    }
    return 'Token JWT inválido o no verificable.';
  }
}
