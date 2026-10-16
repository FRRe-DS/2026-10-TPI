import { Test, TestingModule } from '@nestjs/testing';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from '../../application/documents.service';
import { NotFoundException, GoneException, BadRequestException } from '@nestjs/common';

describe('DocumentsController - RF-8.3', () => {
  let controller: DocumentsController;
  let service: DocumentsService;

  const mockDocumentsService = {
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
    generateReceiptPdfBuffer: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [
        {
          provide: DocumentsService,
          useValue: mockDocumentsService,
        },
      ],
    }).compile();

    controller = module.get<DocumentsController>(DocumentsController);
    service = module.get<DocumentsService>(DocumentsService);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('generateQr debe llamar al servicio y retornar el token y dataUrl', async () => {
    const dto = { tripId: 'trip-1', passengerId: 'usr-1', ttlSeconds: 300 };
    const result = await controller.generateQr(dto);

    expect(result).toBeDefined();
    expect(result.token).toBe('qr_trip-1_abc');
    expect(service.generateQr).toHaveBeenCalledWith(dto);
  });

  it('verifyQr debe llamar al servicio y retornar confirmación exitosa', async () => {
    const dto = { token: 'qr_trip-1_abc', tripId: 'trip-1' };
    const result = await controller.verifyQr(dto);

    expect(result.valid).toBe(true);
    expect(service.verifyQr).toHaveBeenCalledWith(dto);
  });

  it('verifyQr debe propagar 404 si el token no existe', async () => {
    await expect(controller.verifyQr({ token: 'not-found', tripId: 'trip-1' })).rejects.toThrow(NotFoundException);
  });

  it('verifyQr debe propagar 410 si el token ya fue utilizado', async () => {
    await expect(controller.verifyQr({ token: 'used', tripId: 'trip-1' })).rejects.toThrow(GoneException);
  });

  it('verifyQr debe propagar 400 si el viaje no coincide', async () => {
    await expect(controller.verifyQr({ token: 'wrong-trip', tripId: 'trip-2' })).rejects.toThrow(BadRequestException);
  });
});
