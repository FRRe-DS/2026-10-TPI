import * as zlib from 'zlib';
import {
  ReceiptData,
  ReceiptRecord,
  ReceiptRepositoryPort,
} from '../../domain/ports/receipt.repository.port';
import { PdfKitReceiptPdfAdapter } from '../../infrastructure/adapters/pdfkit-receipt-pdf.adapter';
import { GenerateReceiptPdfUseCase } from './generate-receipt-pdf.use-case';
import { IssueReceiptUseCase } from './issue-receipt.use-case';
import { RegisterReceiptUseCase } from './register-receipt.use-case';

function extractPdfText(buf: Buffer): string {
  const latin = buf.toString('latin1');
  const lines: string[] = [];
  const re = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(latin))) {
    const start = match.index + match[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    try {
      const content = zlib.inflateSync(buf.subarray(start, end)).toString('latin1');
      for (const tj of content.matchAll(/\[(.*?)\]\s*TJ/gs)) {
        let line = '';
        for (const h of tj[1].matchAll(/<([0-9a-fA-F]+)>/g)) {
          line += Buffer.from(h[1], 'hex').toString('latin1');
        }
        lines.push(line);
      }
      for (const t of content.matchAll(/\((.*?)\)\s*Tj/g)) {
        lines.push(t[1]);
      }
    } catch {
      // Ignorar streams no comprimidos con Flate
    }
  }
  return lines.join('\n');
}

class InMemoryReceiptRepo implements ReceiptRepositoryPort {
  private readonly store = new Map<string, ReceiptRecord>();
  private seq = 0;

  async save(data: ReceiptData): Promise<ReceiptRecord> {
    const existing = this.store.get(data.tripId);
    if (existing) return existing;

    this.seq++;
    const record: ReceiptRecord = {
      id: `rec-uuid-${this.seq}`,
      receiptCode: `REC-2026-${String(this.seq).padStart(6, '0')}`,
      tripId: data.tripId,
      passengerId: data.passengerId,
      passengerEmail: data.passengerEmail,
      amount: data.amount,
      currency: data.currency,
      driverName: data.driverName,
      issuedAt: new Date('2026-10-17T18:32:21.711Z'),
    };
    this.store.set(data.tripId, record);
    return record;
  }

  async findByTripId(tripId: string): Promise<ReceiptRecord | null> {
    return this.store.get(tripId) ?? null;
  }

  size(): number {
    return this.store.size;
  }
}

describe('IssueReceiptUseCase (RF-8.4 — Generación automática de PDF)', () => {
  let repo: InMemoryReceiptRepo;
  let useCase: IssueReceiptUseCase;

  const sampleData: ReceiptData = {
    tripId: 'trip-auto-001',
    passengerId: 'usr-auto-001',
    passengerEmail: 'pasajero.auto@ejemplo.com',
    amount: 4250.75,
    currency: 'ARS',
    driverName: 'Martín Conductor',
  };

  beforeEach(() => {
    repo = new InMemoryReceiptRepo();
    const register = new RegisterReceiptUseCase(repo);
    const generatePdf = new GenerateReceiptPdfUseCase(new PdfKitReceiptPdfAdapter());
    useCase = new IssueReceiptUseCase(register, generatePdf);
  });

  it('persiste el comprobante y genera automáticamente un Buffer PDF válido con PDFKit', async () => {
    const issued = await useCase.execute(sampleData);

    expect(repo.size()).toBe(1);
    expect(issued.receipt.tripId).toBe('trip-auto-001');
    expect(issued.pdf).toBeInstanceOf(Buffer);
    expect(issued.pdf!.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(issued.pdf!.toString('latin1')).toContain('%%EOF');

    const text = extractPdfText(issued.pdf!);
    expect(text).toContain('COMPROBANTE DE VIAJE');
    expect(text).toContain('ID de viaje: trip-auto-001');
    expect(text).toContain('Fecha de emisión: 17/10/2026, 15:32:21');
    expect(text).toContain('Pasajero: pasajero.auto@ejemplo.com');
    expect(text).toContain('Conductor: Martín Conductor');
    expect(text).toContain('Total abonado: ARS 4250.75');
  });

  it('es idempotente ante eventos repetidos para el mismo viaje y conserva la fecha original', async () => {
    const first = await useCase.execute(sampleData);
    const second = await useCase.execute(sampleData);

    expect(repo.size()).toBe(1);
    expect(second.receipt.id).toBe(first.receipt.id);
    expect(second.receipt.receiptCode).toBe(first.receipt.receiptCode);
    expect(second.receipt.issuedAt.toISOString()).toBe(first.receipt.issuedAt.toISOString());
    expect(second.pdf).toBeInstanceOf(Buffer);
    expect(extractPdfText(second.pdf!)).toContain('17/10/2026, 15:32:21');
  });

  it('mantiene el comprobante registrado y no propaga excepción si falla la generación del PDF', async () => {
    const brokenPdfGen = new GenerateReceiptPdfUseCase({
      generate: jest.fn().mockRejectedValue(new Error('Fallo interno de PDFKit')),
    });
    const resilientUseCase = new IssueReceiptUseCase(
      new RegisterReceiptUseCase(repo),
      brokenPdfGen,
    );

    const issued = await resilientUseCase.execute(sampleData);

    expect(repo.size()).toBe(1);
    expect(issued.receipt.tripId).toBe('trip-auto-001');
    expect(issued.pdf).toBeNull();
    expect(issued.pdfError).toContain('Fallo interno de PDFKit');
  });
});
