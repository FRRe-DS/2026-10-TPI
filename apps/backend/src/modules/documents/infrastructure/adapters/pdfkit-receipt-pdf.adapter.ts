import PDFDocument = require('pdfkit');
import {
  ReceiptPdfData,
  ReceiptPdfGeneratorPort,
} from '../../domain/ports/receipt-pdf-generator.port';

export class PdfKitReceiptPdfAdapter
  implements ReceiptPdfGeneratorPort
{
  generate(data: ReceiptPdfData): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc
        .fontSize(20)
        .text('COMPROBANTE DE VIAJE', { align: 'center' });

      doc
        .fontSize(10)
        .text('Plataforma de Movilidad Urbana - Módulo 8', {
          align: 'center',
        });

      doc.moveDown(2);

      const issuedAt = data.issuedAt.toLocaleString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
      });

      doc.fontSize(12).text(`ID de viaje: ${data.tripId}`);
      doc.text(`Fecha de emisión: ${issuedAt}`);
      doc.text(`Pasajero: ${data.passengerEmail}`);

      if (data.driverName) {
        doc.text(`Conductor: ${data.driverName}`);
      }

      doc.moveDown();

      doc
        .font('Helvetica-Bold')
        .fontSize(14)
        .text(
          `Total abonado: ${data.currency} ${data.amount.toFixed(2)}`,
        );

      doc.moveDown(2);

      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#555555')
        .text('Comprobante digital de viaje.', {
          align: 'center',
        });

      doc.end();
    });
  }
}