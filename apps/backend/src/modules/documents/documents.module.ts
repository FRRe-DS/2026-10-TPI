import { Module } from '@nestjs/common';
import { DocumentsController } from './infrastructure/controllers/documents.controller';
import { DocumentsService } from './application/documents.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { RedisService } from '../../common/redis.service';

import {
  RECEIPT_PDF_GENERATOR,
  ReceiptPdfGeneratorPort,
} from './domain/ports/receipt-pdf-generator.port';
import { PdfKitReceiptPdfAdapter } from './infrastructure/adapters/pdfkit-receipt-pdf.adapter';
import { GenerateReceiptPdfUseCase } from './application/use-cases/generate-receipt-pdf.use-case';

import {
  RECEIPT_REPOSITORY_PORT,
  ReceiptRepositoryPort,
} from './domain/ports/receipt.repository.port';
import { PrismaReceiptRepository } from './infrastructure/persistence/prisma-receipt.repository';
import { RegisterReceiptUseCase } from './application/use-cases/register-receipt.use-case';
import { ResendReceiptUseCase } from './application/use-cases/resend-receipt.use-case';
import { NotificationsService } from '../notifications/application/notifications.service';

import {
  QR_TOKEN_REPOSITORY_PORT,
  QrTokenRepositoryPort,
} from './domain/ports/qr-token.repository.port';
import { PrismaQrTokenRepository } from './infrastructure/persistence/prisma-qr-token.repository';
import { GenerateQrUseCase } from './application/use-cases/generate-qr.use-case';
import { VerifyQrUseCase } from './application/use-cases/verify-qr.use-case';

@Module({
  imports: [NotificationsModule],
  controllers: [DocumentsController],
  providers: [
    // --- Puerto de persistencia de tokens QR (RF-8.3, RNF-08) ---
    {
      provide: QR_TOKEN_REPOSITORY_PORT,
      useClass: PrismaQrTokenRepository,
    },
    {
      provide: GenerateQrUseCase,
      useFactory: (repo: QrTokenRepositoryPort, redis: RedisService) =>
        new GenerateQrUseCase(repo, redis),
      inject: [QR_TOKEN_REPOSITORY_PORT, RedisService],
    },
    {
      provide: VerifyQrUseCase,
      useFactory: (repo: QrTokenRepositoryPort, redis: RedisService) =>
        new VerifyQrUseCase(repo, redis),
      inject: [QR_TOKEN_REPOSITORY_PORT, RedisService],
    },

    // --- Fachada de aplicación ---
    DocumentsService,

    // --- Puerto de generación PDF ---
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

    // --- Puerto de persistencia de comprobantes ---
    {
      provide: RECEIPT_REPOSITORY_PORT,
      useClass: PrismaReceiptRepository,
    },
    {
      provide: RegisterReceiptUseCase,
      useFactory: (repo: ReceiptRepositoryPort) =>
        new RegisterReceiptUseCase(repo),
      inject: [RECEIPT_REPOSITORY_PORT],
    },

    // --- Reenvío de comprobantes con adjunto PDF (RF-8.5) ---
    {
      provide: ResendReceiptUseCase,
      useFactory: (
        repo: ReceiptRepositoryPort,
        pdfGen: GenerateReceiptPdfUseCase,
        notif: NotificationsService,
      ) => new ResendReceiptUseCase(repo, pdfGen, notif),
      inject: [
        RECEIPT_REPOSITORY_PORT,
        GenerateReceiptPdfUseCase,
        NotificationsService,
      ],
    },
  ],
  exports: [
    DocumentsService,
    RegisterReceiptUseCase,
    ResendReceiptUseCase,
    GenerateQrUseCase,
    VerifyQrUseCase,
  ],
})
export class DocumentsModule {}
