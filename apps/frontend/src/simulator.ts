export const simulatorModules = ['M5', 'M6', 'M7', 'M9'] as const;
export type SimulatorModule = typeof simulatorModules[number];

export interface SimulatorPayload {
  eventoId: string;
  tipo: string;
  origen: SimulatorModule;
  ocurridoEn: string;
  viajeId?: string;
  pagoId?: string;
  reservaId?: string;
  destinatarios: { usuarioId: string; rol: 'CLIENTE'; email: string; canalesPreferidos: ['EMAIL'] }[];
  detalle: {
    origen?: string;
    destino?: string;
    tipoVehiculo?: string;
    fechaProgramada?: string;
    zonaHoraria?: string;
    motivo?: string;
    importe: { monto: number; moneda: 'ARS' };
  };
}

export interface SimulationResult {
  eventoId: string;
  module: SimulatorModule;
  eventType: string;
  referenceId: string;
  tripId?: string;
  receiptTripId?: string;
  recipient: string;
  timestamp: string;
  status?: number;
  recibidoEn?: string;
  error?: string;
  receipt?: { id: string; code: string };
  delivery?: { status: 'SENT' | 'FAILED'; error?: string };
  checking: boolean;
}

export function createSimulatorId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

async function readJson(url: string, token?: string | null) {
  const init: RequestInit = { signal: AbortSignal.timeout(5000) };
  if (token) {
    init.headers = { Authorization: `Bearer ${token}` };
  }
  const response = await fetch(url, init);
  return response.ok ? response.json() : null;
}

export async function trackSimulation(
  apiBase: string,
  event: SimulationResult,
  update: (changes: Partial<SimulationResult>) => void,
  getToken?: () => Promise<string | null>,
) {
  const logsUrl = `${apiBase}/notifications/logs?${new URLSearchParams({ recipient: event.recipient })}`;
  const receiptUrl = event.receiptTripId
    ? `${apiBase}/comprobantes/${encodeURIComponent(event.receiptTripId)}`
    : undefined;
  let receipt: SimulationResult['receipt'];
  let delivery: SimulationResult['delivery'];

  try {
    const token = getToken ? await getToken() : null;
    for (let attempt = 0; attempt < 8; attempt++) {
      await Promise.all([
        !delivery && readJson(logsUrl, token).then((logs: {
          eventId: string;
          status: 'SENT' | 'FAILED' | 'PENDING';
          lastError?: string;
        }[] | null) => {
          const log = logs?.find(item => item.eventId === event.eventoId);
          if (log?.status === 'SENT' || log?.status === 'FAILED') {
            delivery = { status: log.status, error: log.lastError };
            update({ delivery });
          }
        }).catch(() => undefined),
        receiptUrl && !receipt && readJson(receiptUrl, token).then((data: {
          comprobanteId?: string;
          codigoComprobante?: string;
          viajeId?: string;
        } | null) => {
          if (data?.comprobanteId && data.codigoComprobante && data.viajeId === event.receiptTripId) {
            receipt = { id: data.comprobanteId, code: data.codigoComprobante };
            update({ receipt });
          }
        }).catch(() => undefined),
      ]);
      if (delivery && (!receiptUrl || receipt)) break;
      if (attempt < 7) await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally {
    update({ checking: false });
  }
}
