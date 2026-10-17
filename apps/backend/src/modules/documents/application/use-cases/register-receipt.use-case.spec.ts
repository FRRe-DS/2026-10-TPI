import { RegisterReceiptUseCase } from './register-receipt.use-case';
import {
  ReceiptData,
  ReceiptRecord,
  ReceiptRepositoryPort,
} from '../../domain/ports/receipt.repository.port';

// ─── In-Memory stub del repositorio (sin Supabase, sin Prisma) ──────────────

class InMemoryReceiptRepository implements ReceiptRepositoryPort {
  private store: Map<string, ReceiptRecord> = new Map();
  private counter = 0;

  async save(data: ReceiptData): Promise<ReceiptRecord> {
    // Idempotencia real: si ya existe, lo devuelve sin crear duplicado
    const existing = await this.findByTripId(data.tripId);
    if (existing) return existing;

    this.counter++;
    const record: ReceiptRecord = {
      id: `id-${this.counter}`,
      receiptCode: `REC-2026-${String(this.counter).padStart(5, '0')}`,
      tripId: data.tripId,
      passengerId: data.passengerId,
      passengerEmail: data.passengerEmail,
      amount: data.amount,
      currency: data.currency ?? 'ARS',
      driverName: data.driverName,
      metadata: {},
      issuedAt: new Date('2026-10-17T12:00:00.000Z'),
    };
    this.store.set(data.tripId, record);
    return record;
  }

  async findByTripId(tripId: string): Promise<ReceiptRecord | null> {
    return this.store.get(tripId) ?? null;
  }

  /** Helper para verificar estado interno en tests */
  size(): number {
    return this.store.size;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RegisterReceiptUseCase', () => {
  let useCase: RegisterReceiptUseCase;
  let repo: InMemoryReceiptRepository;

  const baseData: ReceiptData = {
    tripId: 'trip-test-001',
    passengerId: 'usr-p-001',
    passengerEmail: 'pasajero@test.com',
    amount: 3500,
    currency: 'ARS',
    driverName: 'Juan Conductor',
  };

  beforeEach(() => {
    repo = new InMemoryReceiptRepository();
    useCase = new RegisterReceiptUseCase(repo);
  });

  // ── 1. Registro normal ────────────────────────────────────────────────────

  describe('execute – registro de comprobante', () => {
    it('debe persistir el comprobante y devolver los datos completos', async () => {
      const result = await useCase.execute(baseData);

      expect(result.tripId).toBe('trip-test-001');
      expect(result.passengerId).toBe('usr-p-001');
      expect(result.passengerEmail).toBe('pasajero@test.com');
      expect(result.amount).toBe(3500);
      expect(result.currency).toBe('ARS');
      expect(result.driverName).toBe('Juan Conductor');
      expect(result.receiptCode).toMatch(/^REC-\d{4}-\d{5}$/);
      expect(result.id).toBeDefined();
      expect(result.issuedAt).toBeInstanceOf(Date);
    });

    it('debe crear exactamente un registro en el repositorio', async () => {
      await useCase.execute(baseData);
      expect(repo.size()).toBe(1);
    });

    it('debe funcionar sin driverName (campo opcional)', async () => {
      const data = { ...baseData, driverName: undefined };
      const result = await useCase.execute(data);
      expect(result.driverName).toBeUndefined();
      expect(result.receiptCode).toBeDefined();
    });

    it('debe usar ARS como moneda por defecto si no se provee currency', async () => {
      const data: ReceiptData = {
        tripId: 'trip-currency-default',
        passengerId: 'usr-p-002',
        passengerEmail: 'test@test.com',
        amount: 1000,
        currency: undefined as any,
      };
      const result = await useCase.execute(data);
      expect(result.currency).toBe('ARS');
    });
  });

  // ── 2. Idempotencia / Anti-duplicados ─────────────────────────────────────

  describe('execute – idempotencia (anti-duplicados)', () => {
    it('llamadas repetidas con el mismo tripId devuelven el mismo comprobante', async () => {
      const first = await useCase.execute(baseData);
      const second = await useCase.execute(baseData);

      expect(second.id).toBe(first.id);
      expect(second.receiptCode).toBe(first.receiptCode);
    });

    it('múltiples llamadas con el mismo tripId no crean registros adicionales', async () => {
      await useCase.execute(baseData);
      await useCase.execute(baseData);
      await useCase.execute(baseData);

      expect(repo.size()).toBe(1);
    });

    it('viajes distintos generan comprobantes distintos', async () => {
      const first = await useCase.execute({ ...baseData, tripId: 'trip-A' });
      const second = await useCase.execute({ ...baseData, tripId: 'trip-B' });

      expect(first.id).not.toBe(second.id);
      expect(first.receiptCode).not.toBe(second.receiptCode);
      expect(repo.size()).toBe(2);
    });
  });

  // ── 3. Búsqueda (findByTripId indirecto) ─────────────────────────────────

  describe('findByTripId (a través del repositorio)', () => {
    it('devuelve null para un tripId que no existe', async () => {
      const result = await repo.findByTripId('trip-inexistente');
      expect(result).toBeNull();
    });

    it('encuentra el comprobante después de registrarlo', async () => {
      await useCase.execute(baseData);
      const found = await repo.findByTripId(baseData.tripId);
      expect(found).not.toBeNull();
      expect(found!.tripId).toBe(baseData.tripId);
    });

    it('preserva la fecha de emisión original (issuedAt no cambia en re-búsqueda)', async () => {
      const created = await useCase.execute(baseData);
      const found = await repo.findByTripId(baseData.tripId);
      expect(found!.issuedAt.toISOString()).toBe(created.issuedAt.toISOString());
    });
  });
});

