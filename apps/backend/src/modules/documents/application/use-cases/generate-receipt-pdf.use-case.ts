import {
  ReceiptPdfData,
  ReceiptPdfGeneratorPort,
} from '../../domain/ports/receipt-pdf-generator.port';

export class GenerateReceiptPdfUseCase {
  constructor(
    private readonly pdfGenerator: ReceiptPdfGeneratorPort,
  ) {}

  execute(data: ReceiptPdfData): Promise<Uint8Array> {
    return this.pdfGenerator.generate(data);
  }
}