import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createSimulatorId, SimulationResult, trackSimulation } from './simulator';

describe('Frontend Event Simulator helpers (RNF-15)', () => {
  it('createSimulatorId genera UUID v4 válidos y únicos', () => {
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const first = createSimulatorId();
    const second = createSimulatorId();

    assert.match(first, uuidV4Regex);
    assert.match(second, uuidV4Regex);
    assert.notEqual(first, second);
  });

  it('trackSimulation actualiza delivery y receipt en la primera iteración y finaliza checking', async () => {
    const originalFetch = globalThis.fetch;
    const updates: Partial<SimulationResult>[] = [];
    const calledUrls: string[] = [];

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.includes('/notifications/logs')) {
        return new Response(
          JSON.stringify([{ eventId: 'evt-sim-1', status: 'SENT' }]),
          { status: 200 },
        );
      }
      if (url.includes('/comprobantes/')) {
        return new Response(
          JSON.stringify({
            comprobanteId: 'comp-1',
            codigoComprobante: 'REC-2026-SIM01',
            viajeId: 'trip-sim-1',
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    try {
      await trackSimulation(
        'http://localhost:3000/api/v1',
        {
          eventoId: 'evt-sim-1',
          module: 'M6',
          eventType: 'VIAJE_FINALIZADO',
          referenceId: 'trip-sim-1',
          receiptTripId: 'trip-sim-1',
          recipient: 'pasajero@test.com',
          timestamp: '2026-11-28T10:00:00Z',
          checking: true,
        },
        (changes) => updates.push(changes),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(calledUrls.length, 2);
    assert.deepEqual(updates, [
      { delivery: { status: 'SENT', error: undefined } },
      { receipt: { id: 'comp-1', code: 'REC-2026-SIM01' } },
      { checking: false },
    ]);
  });

  it('trackSimulation tolera errores de red y finaliza checking en false tras los intentos', async () => {
    const originalFetch = globalThis.fetch;
    const originalSetTimeout = globalThis.setTimeout;
    const updates: Partial<SimulationResult>[] = [];
    let fetchCount = 0;

    globalThis.fetch = (async () => {
      fetchCount++;
      throw new Error('Network unreachable');
    }) as unknown as typeof fetch;

    globalThis.setTimeout = ((fn: (...args: unknown[]) => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    try {
      await trackSimulation(
        'http://localhost:3000/api/v1',
        {
          eventoId: 'evt-sim-err',
          module: 'M9',
          eventType: 'RESERVA_CREADA',
          referenceId: 'res-1',
          recipient: 'reserva@test.com',
          timestamp: '2026-11-28T10:00:00Z',
          checking: true,
        },
        (changes) => updates.push(changes),
      );
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = originalSetTimeout;
    }

    assert.equal(fetchCount, 8);
    assert.deepEqual(updates, [{ checking: false }]);
  });
});
