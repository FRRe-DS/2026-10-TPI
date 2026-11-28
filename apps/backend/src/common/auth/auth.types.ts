export const CONTRACT_ROLES = ['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO'] as const;

export type AppRole = (typeof CONTRACT_ROLES)[number];

export interface AuthenticatedIdentity {
  authenticated: true;
  sub: string;
  roles: string[];
  /**
   * Rol principal (primer rol del contrato encontrado) para compatibilidad
   * con lógica existente de trazabilidad y ownership.
   */
  rol?: string;
  azp?: string;
  iss?: string;
  aud?: string | string[];
}

export interface JwtAuthConfig {
  jwksUri?: string;
  issuer?: string | string[];
  audience?: string | string[];
  algorithms: string[];
  keycloakClientIds: string[];
  jwksCacheMaxAgeMs: number;
  jwksTimeoutMs: number;
  clockToleranceSeconds: number;
  nodeEnv: string;
}
