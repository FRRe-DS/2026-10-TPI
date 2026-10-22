import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, GoneException, BadRequestException } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from '../../application/documents.service';
import { GenerateReceiptPdfUseCase } from '../../application/use-cases/generate-receipt-pdf.use-case';
import { RegisterReceiptUseCase } from '../../application/use-cases/register-receipt.use-case';
import { RegisterReceiptDto } from '../../application/dto/documents.dto';
import { ReceiptRecord } from '../../domain/ports/receipt.repository.port';
import { Response } from 'express';

describe('DocumentsController (RF-8.3, RF-8.4, RF-8.5)', () => {
  let controller: DocumentsController;
  let documentsService: jest.Mocked<Partial<DocumentsService>>;
  let generatePdfUseCase: jest.Mocked<Partial<GenerateReceiptPdfUseCase>>;
  let registerReceiptUseCase: jest.Mocked<Partial<RegisterReceiptUseCase>>;

  const mockOriginalDate = new Date('2026-10-15T14:30:00.000Z');

  const mockReceiptRecord: ReceiptRecord = {
    id: 'receipt-uuid-123',
    receiptCode: 'REC-2026-00042',
    tripId: 'trip-abc-123',
    passengerId: 'usr-p-456',
    passengerEmail: 'pasajero@ejemplo.com',
    amount: 3500.5,
    currency: 'ARS',
    driverName: 'Juan Conductor',
    metadata: { route: 'Centro -> Norte' },
    issuedAt: mockOriginalDate,
  };

  const createMockResponse = () => {
    const res: Partial<Response> = {};
    res.set = jest.fn().mockReturnValue(res);
    res.end = jest.fn().mockReturnValue(res);
    return res as Response;
  };

  beforeEach(async () => {
    documentsService = {
      findReceiptByTripId: jest.fn(),
      generateQr: jest.fn().mockResolvedValue({
        token: 'qr_trip-1_abc',
        tripId: 'trip-1',
        qrDataUrl: 'data:image/png;base64,sample',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        ttlSeconds: 300,
      }),
      verifyQr: jest.fn().mockImplementation(async (dto) => {
        if (dto.token === 'not-found') throw new NotFoundException();
        if (dto.token === 'used') throw new GoneException('Ya utilizado');
        if (dto.token === 'wrong-trip') throw new BadRequestException('Viaje no coincide');
        return {
          valid: true,
          tripId: dto.tripId,
          token: dto.token,
          verifiedAt: new Date().toISOString(),
          message: 'Código QR verificado exitosamente. Inicio de viaje habilitado.',
        };
      }),
      resendReceipt: jest.fn(),
    };

    generatePdfUseCase = {
      execute: jest.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])), // %PDF
    };

    registerReceiptUseCase = {
      execute: jest.fn().mockResolvedValue(mockReceiptRecord),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [
        { provide: DocumentsService, useValue: documentsService },
        { provide: GenerateReceiptPdfUseCase, useValue: generatePdfUseCase },
        { provide: RegisterReceiptUseCase, useValue: registerReceiptUseCase },
      ],
    }).compile();

    controller = module.get<DocumentsController>(DocumentsController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  describe('QR Endpoints (RF-8.3)', () => {
    it('generateQr debe llamar al servicio y retornar el token y dataUrl', async () => {
      const dto = { tripId: 'trip-1', passengerId: 'usr-1', ttlSeconds: 300 };
      const result = await controller.generateQr(dto);

      expect(result).toBeDefined();
      expect(result.token).toBe('qr_trip-1_abc');
      expect(documentsService.generateQr).toHaveBeenCalledWith(dto);
    });

    it('verifyQr debe llamar al servicio y retornar confirmación exitosa', async () => {
      const dto = { token: 'qr_trip-1_abc', tripId: 'trip-1' };
      const result = await controller.verifyQr(dto);

      expect(result.valid).toBe(true);
      expect(documentsService.verifyQr).toHaveBeenCalledWith(dto);
    });

    it('verifyQr debe propagar 404 si el token no existe', async () => {
      await expect(controller.verifyQr({ token: 'not-found', tripId: 'trip-1' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('verifyQr debe propagar 410 si el token ya fue utilizado', async () => {
      await expect(controller.verifyQr({ token: 'used', tripId: 'trip-1' })).rejects.toThrow(
        GoneException,
      );
    });

    it('verifyQr debe propagar 400 si el viaje no coincide', async () => {
      await expect(controller.verifyQr({ token: 'wrong-trip', tripId: 'trip-2' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('POST /documents/receipts (registerReceipt - RF-8.4)', () => {
    const dto: RegisterReceiptDto = {
      tripId: 'trip-abc-123',
      passengerId: 'usr-p-456',
      passengerEmail: 'pasajero@ejemplo.com',
      amount: 3500.5,
      currency: 'ARS',
      driverName: 'Juan Conductor',
    };

    it('debe registrar el comprobante y responder con ReceiptResponseDto formateado', async () => {
      const response = await controller.registerReceipt(dto);

      expect(registerReceiptUseCase.execute).toHaveBeenCalledWith({
        tripId: 'trip-abc-123',
        passengerId: 'usr-p-456',
        passengerEmail: 'pasajero@ejemplo.com',
        amount: 3500.5,
        currency: 'ARS',
        driverName: 'Juan Conductor',
      });

      expect(response).toEqual({
        id: 'receipt-uuid-123',
        receiptCode: 'REC-2026-00042',
        tripId: 'trip-abc-123',
        passengerId: 'usr-p-456',
        passengerEmail: 'pasajero@ejemplo.com',
        amount: 3500.5,
        currency: 'ARS',
        driverName: 'Juan Conductor',
        issuedAt: mockOriginalDate.toISOString(),
      });
    });

    it('debe utilizar ARS por defecto si no se especifica currency', async () => {
      const dtoWithoutCurrency: RegisterReceiptDto = {
        ...dto,
        currency: undefined,
      };

      await controller.registerReceipt(dtoWithoutCurrency);

      expect(registerReceiptUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'ARS' }),
      );
    });
  });

  describe('GET /documents/receipts/:tripId/download (downloadPdf - RF-8.4)', () => {
    it('debe regenerar y descargar el PDF cuando el comprobante existe, preservando la fecha de emisión original', async () => {
      (documentsService.findReceiptByTripId as jest.Mock).mockResolvedValue(mockReceiptRecord);
      const res = createMockResponse();

      await controller.downloadPdf('trip-abc-123', res);

      expect(documentsService.findReceiptByTripId).toHaveBeenCalledWith('trip-abc-123');
      expect(registerReceiptUseCase.execute).not.toHaveBeenCalled();

      expect(generatePdfUseCase.execute).toHaveBeenCalledWith({
        tripId: 'trip-abc-123',
        passengerEmail: 'pasajero@ejemplo.com',
        amount: 3500.5,
        currency: 'ARS',
        driverName: 'Juan Conductor',
        issuedAt: mockOriginalDate,
      });

      expect(res.set).toHaveBeenCalledWith({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="comprobante-REC-2026-00042.pdf"',
        'Content-Length': 4,
      });

      expect(res.end).toHaveBeenCalledWith(Buffer.from(new Uint8Array([37, 80, 68, 70])));
    });

    it('debe responder 404 (NotFoundException) si el comprobante no existe en base de datos', async () => {
      (documentsService.findReceiptByTripId as jest.Mock).mockResolvedValue(null);
      const res = createMockResponse();

      await expect(controller.downloadPdf('trip-inexistente', res)).rejects.toThrow(
        NotFoundException,
      );

      expect(generatePdfUseCase.execute).not.toHaveBeenCalled();
      expect(res.end).not.toHaveBeenCalled();
    });
  });

  describe('POST /documents/receipts/resend (resendReceipt - RF-8.5)', () => {
    const resendDto = {
      tripId: 'trip-abc-123',
      email: 'destino@ejemplo.com',
    };

    it('debe invocar a documentsService.resendReceipt y responder 200 con ResendReceiptResponseDto', async () => {
      const expectedResponse = {
        success: true,
        tripId: 'trip-abc-123',
        receiptCode: 'REC-2026-00042',
        sentTo: 'destino@ejemplo.com',
        timestamp: '2026-10-17T15:40:00.000Z',
      };
      (documentsService.resendReceipt as jest.Mock).mockResolvedValue(expectedResponse);

      const result = await controller.resendReceipt(resendDto);

      expect(documentsService.resendReceipt).toHaveBeenCalledWith(resendDto);
      expect(result).toEqual(expectedResponse);
    });

    it('debe propagar NotFoundException (404) si el viaje no existe', async () => {
      (documentsService.resendReceipt as jest.Mock).mockRejectedValue(
        new NotFoundException('No existe comprobante para este viaje'),
      );

      await expect(controller.resendReceipt(resendDto)).rejects.toThrow(NotFoundException);
    });
  });
});
