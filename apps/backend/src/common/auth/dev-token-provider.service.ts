import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { AppRole, CONTRACT_ROLES } from './auth.types';

export interface DevTokenRequest {
  sub?: string;
  role?: string;
  roles?: string[];
  expiresInSeconds?: number;
}

export interface DevTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  sub: string;
  roles: AppRole[];
  iss: string;
  aud: string;
}

const DEFAULT_DEV_ISSUER = 'urn:m8:local-dev-token-provider';
const DEFAULT_DEV_AUDIENCE = 'm8-notificaciones-dev';
const DEFAULT_TTL_SECONDS = 900;
const MAX_TTL_SECONDS = 3600;

/**
 * Proveedor local efímero de tokens JWT firmados con RSA-2048 (RS256) y JWKS público.
 *
 * Propósito: permitir pruebas locales y operación del dashboard/simulador RNF-15 con
 * verificación criptográfica REAL, sin almacenar secretos en el frontend ni crear
 * excepciones de autenticación en producción.
 *
 * Seguridad:
 * - Solo se habilita cuando NODE_ENV !== 'production' Y AUTH_DEV_TOKEN_PROVIDER_ENABLED === 'true'.
 * - En producción queda estrictamente deshabilitado aunque la variable esté presente.
 * - Las claves RSA se generan en memoria por ejecución (efímeras, nunca persistidas).
 */
@Injectable()
export class DevTokenProviderService {
  private readonly logger = new Logger(DevTokenProviderService.name);
  private readonly enabled: boolean;
  private readonly kid: string;
  private readonly privateKeyPem?: string;
  private readonly publicKeyPem?: string;
  private readonly publicJwk?: Record<string, unknown>;
  private readonly issuer: string;
  private readonly audience: string;

  constructor() {
    const nodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase();
    const flagEnabled =
      (process.env.AUTH_DEV_TOKEN_PROVIDER_ENABLED || '').trim().toLowerCase() === 'true';
    const isProductionOrShared =
      nodeEnv === 'production' || nodeEnv === 'prod' || nodeEnv === 'staging';
    const hasExternalJwks = Boolean(process.env.AUTH_JWKS_URI?.trim());

    if (isProductionOrShared || hasExternalJwks) {
      if (flagEnabled) {
        this.logger.error(
          `Proveedor local de tokens efímero estrictamente DESHABILITADO por seguridad ` +
            `(NODE_ENV=${nodeEnv}, AUTH_JWKS_URI=${hasExternalJwks ? 'configurado' : 'no-configurado'}).`,
        );
      }
      this.enabled = false;
      this.kid = '';
      this.issuer = '';
      this.audience = '';
      return;
    }

    this.enabled = flagEnabled;
    const configuredIssuer = process.env.AUTH_JWT_ISSUER?.split(',')[0]?.trim();
    const configuredAudience = process.env.AUTH_JWT_AUDIENCE?.split(',')[0]?.trim();
    this.issuer = configuredIssuer || DEFAULT_DEV_ISSUER;
    this.audience = configuredAudience || DEFAULT_DEV_AUDIENCE;

    if (!this.enabled) {
      this.kid = '';
      return;
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });

    this.kid = `m8-dev-${crypto.randomBytes(8).toString('hex')}`;
    this.privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    this.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const exportedJwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    this.publicJwk = {
      ...exportedJwk,
      kid: this.kid,
      use: 'sig',
      alg: 'RS256',
    };

    this.logger.warn(
      `Proveedor local de tokens RS256 habilitado solo para entorno ${nodeEnv} (kid=${this.kid}). ` +
        'Nunca usar en producción.',
    );
  }

  isEnabled(): boolean {
    return this.enabled && Boolean(this.privateKeyPem && this.publicKeyPem);
  }

  getIssuer(): string {
    return this.issuer;
  }

  getAudience(): string {
    return this.audience;
  }

  getJwks(): { keys: Record<string, unknown>[] } {
    if (!this.isEnabled() || !this.publicJwk) {
      return { keys: [] };
    }
    return { keys: [this.publicJwk] };
  }

  getPublicKeyPem(kid?: string): string | null {
    if (!this.isEnabled() || !this.publicKeyPem) {
      return null;
    }
    if (kid && kid !== this.kid) {
      return null;
    }
    return this.publicKeyPem;
  }

  issueToken(request: DevTokenRequest = {}): DevTokenResponse {
    if (!this.isEnabled() || !this.privateKeyPem) {
      throw new BadRequestException('El proveedor local de tokens de desarrollo no está habilitado.');
    }

    const rawRoles: string[] = [];
    if (typeof request.role === 'string' && request.role.trim()) {
      rawRoles.push(request.role.trim().toUpperCase());
    }
    if (Array.isArray(request.roles)) {
      for (const r of request.roles) {
        if (typeof r === 'string' && r.trim()) {
          rawRoles.push(r.trim().toUpperCase());
        }
      }
    }
    if (rawRoles.length === 0) {
      rawRoles.push('OPERADOR');
    }

    const validSet = new Set<string>(CONTRACT_ROLES);
    const normalizedRoles: AppRole[] = [];
    for (const r of rawRoles) {
      if (!validSet.has(r)) {
        throw new BadRequestException(
          `Rol de desarrollo inválido: ${r}. Roles admitidos: ${CONTRACT_ROLES.join(', ')}.`,
        );
      }
      if (!normalizedRoles.includes(r as AppRole)) {
        normalizedRoles.push(r as AppRole);
      }
    }

    const sub =
      typeof request.sub === 'string' && request.sub.trim()
        ? request.sub.trim().slice(0, 128)
        : `dev-${normalizedRoles[0].toLowerCase()}`;

    const requestedTtl = Number(request.expiresInSeconds ?? DEFAULT_TTL_SECONDS);
    const ttlSeconds = Number.isFinite(requestedTtl)
      ? Math.min(MAX_TTL_SECONDS, Math.max(30, Math.floor(requestedTtl)))
      : DEFAULT_TTL_SECONDS;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        sub,
        roles: normalizedRoles,
        realm_access: { roles: normalizedRoles },
        azp: 'm8-local-dev',
        nbf: nowSeconds,
      },
      this.privateKeyPem,
      {
        algorithm: 'RS256',
        keyid: this.kid,
        issuer: this.issuer,
        audience: this.audience,
        expiresIn: ttlSeconds,
      },
    );

    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: ttlSeconds,
      sub,
      roles: normalizedRoles,
      iss: this.issuer,
      aud: this.audience,
    };
  }
}
