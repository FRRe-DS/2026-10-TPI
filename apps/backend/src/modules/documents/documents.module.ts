import { Module } from '@nestjs/common';
import { DocumentsController } from './infrastructure/controllers/documents.controller';
import { DocumentsService } from './application/documents.service';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../../common/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';

import {
  RECEIPT_PDF_GENERATOR,
  ReceiptPdfGeneratorPort,
} from './domain/ports/receipt-pdf-generator.port';
import { PdfKitReceiptPdfAdapter } from './infrastructure/adapters/pdfkit-receipt-pdf.adapter';
import { GenerateReceiptPdfUseCase } from './application/use-cases/generate-receipt-pdf.use-case';

@Module({
  imports: [NotificationsModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    RedisService,
    PrismaService,
    {
      provide: RECEIPT_PDF_GENERATOR,
      useClass: PdfKitReceiptPdfAdapter,
    },
    {
      provide: GenerateReceiptPdfUseCase,
      useFactory: (pdfGenerator: ReceiptPdfGeneratorPort) =>
        new GenerateReceiptPdfUseCase(pdfGenerator),
      inject: [RECEIPT_PDF_GENERATOR],
    },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}