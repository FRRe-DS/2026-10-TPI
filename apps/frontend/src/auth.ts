export type FrontendAuthRole = 'OPERADOR' | 'SERVICIO' | 'CLIENTE';

interface CachedDevToken {
  token: string;
  expiresAtMs: number;
}

const devTokenCache = new Map<FrontendAuthRole, CachedDevToken>();
let manualToken: string | null = null;
let devProviderUnavailable = false;

export function setManualBearerToken(token: string): void {
  const cleaned = token.trim().replace(/^Bearer\s+/i, '').trim();
  manualToken = cleaned.length > 0 ? cleaned : null;
}

export function getManualBearerToken(): string {
  return manualToken ?? '';
}

export function clearDevTokenCache(): void {
  devTokenCache.clear();
  devProviderUnavailable = false;
}

/**
 * Obtiene un JWT Bearer válido para el rol solicitado:
 * 1. Si el operador ingresó manualmente un JWT (ej. emitido por Keycloak/M1), se usa ese token.
 * 2. En desarrollo local, solicita un JWT RS256 efímero al proveedor local (/auth/dev/token)
 *    sin almacenar secretos confidenciales en el frontend.
 */
export async function getBearerToken(
  apiBase: string,
  role: FrontendAuthRole = 'OPERADOR',
): Promise<string | null> {
  if (manualToken) {
    return manualToken;
  }

  const cached = devTokenCache.get(role);
  if (cached && cached.expiresAtMs - Date.now() > 30_000) {
    return cached.token;
  }

  if (devProviderUnavailable) {
    return null;
  }

  try {
    const response = await fetch(`${apiBase}/auth/dev/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role,
        sub: role === 'SERVICIO' ? 'm8-frontend-simulator' : 'm8-dashboard-operator',
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (response.status === 404) {
      devProviderUnavailable = true;
      return null;
    }

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      return null;
    }

    const ttlMs = Math.max(60, Number(data.expires_in ?? 900)) * 1000;
    devTokenCache.set(role, {
      token: data.access_token,
      expiresAtMs: Date.now() + ttlMs,
    });
    return data.access_token;
  } catch {
    return null;
  }
}

export async function authenticatedFetch(
  apiBase: string,
  url: string,
  init: RequestInit = {},
  role: FrontendAuthRole = 'OPERADOR',
): Promise<Response> {
  const token = await getBearerToken(apiBase, role);
  const headers = new Headers(init.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers });
}

export async function openAuthenticatedPdf(
  apiBase: string,
  url: string,
  fallbackFilename = 'comprobante.pdf',
): Promise<boolean> {
  const res = await authenticatedFetch(apiBase, url, { method: 'GET' }, 'OPERADOR');
  if (!res.ok) {
    return false;
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const opened = window.open(objectUrl, '_blank', 'noopener,noreferrer');
  if (!opened) {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fallbackFilename;
    link.click();
  }
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return true;
}
