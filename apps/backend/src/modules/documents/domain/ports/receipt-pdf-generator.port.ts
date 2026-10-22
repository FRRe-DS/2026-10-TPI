export interface ReceiptPdfData {
  tripId: string;
  passengerEmail: string;
  amount: number;
  currency: string;
  driverName?: string;
  issuedAt: Date;
}

export interface ReceiptPdfGeneratorPort {
  generate(data: ReceiptPdfData): Promise<Uint8Array>;
}

export const RECEIPT_PDF_GENERATOR = Symbol(
  'RECEIPT_PDF_GENERATOR',
);