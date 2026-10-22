import { NotFoundException, BadGatewayException } from '@nestjs/common';
import { NotificationStatus } from '@prisma/client';
import { ResendReceiptUseCase } from './resend-receipt.use-case';
import {
  ReceiptRecord,
  ReceiptRepositoryPort,
} from '../../domain/ports/receipt.repository.port';
import { GenerateReceiptPdfUseCase } from './generate-receipt-pdf.use-case';
import { NotificationsService } from '../../../notifications/application/notifications.service';
import { NotificationChannelDto } from '../../../notifications/application/dto/send-notification.dto';
import { ResendReceiptDto } from '../dto/documents.dto';

describe('ResendReceiptUseCase (Unit Tests con Dobles de Prueba)', () => {
  let useCase: ResendReceiptUseCase;
  let mockReceiptRepo: jest.Mocked<ReceiptRepositoryPort>;
  let mockPdfGenerator: jest.Mocked<Partial<GenerateReceiptPdfUseCase>>;
  let mockNotificationsService: jest.Mocked<Partial<NotificationsService>>;

  const mockOriginalDate = new Date('2026-10-15T10:00:00.000Z');
  const mockPdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]); // %PDF-1.4

  const mockReceipt: ReceiptRecord = {
    id: 'receipt-uuid-999',
    receiptCode: 'REC-2026-A1B2C3',
    tripId: 'trip-resend-001',
    passengerId: 'usr-p-555',
    passengerEmail: 'pasajero.original@test.com',
    amount: 3800,
    currency: 'ARS',
    driverName: 'Conductor Asignado',
    metadata: { passengerEmail: 'pasajero.original@test.com' },
    issuedAt: mockOriginalDate,
  };

  const dto: ResendReceiptDto = {
    tripId: 'trip-resend-001',
    email: 'destino.reenvio@test.com',
  };

  beforeEach(() => {
    mockReceiptRepo = {
      save: jest.fn(),
      findByTripId: jest.fn(),
    };

    mockPdfGenerator = {
      execute: jest.fn().mockResolvedValue(mockPdfBytes),
    };

    mockNotificationsService = {
      send: jest.fn().mockResolvedValue({
        success: true,
        id: 'log-123',
        status: 'SENT',
      }),
    };

    useCase = new ResendReceiptUseCase(
      mockReceiptRepo,
      mockPdfGenerator as unknown as GenerateReceiptPdfUseCase,
      mockNotificationsService as unknown as NotificationsService,
    );
  });


  describe('1. Reenvío exitoso con adjunto PDF', () => {
    it('debe buscar el comprobante, regenerar el PDF con la fecha original y enviarlo como adjunto application/pdf', async () => {
      mockReceiptRepo.findByTripId.mockResolvedValue(mockReceipt);

      const result = await useCase.execute(dto);

      // 1. Debe buscar el comprobante persistido
      expect(mockReceiptRepo.findByTripId).toHaveBeenCalledWith('trip-resend-001');

      // 2. NO debe llamar a save (no crea ni modifica registros)
      expect(mockReceiptRepo.save).not.toHaveBeenCalled();

      // 3. Debe regenerar el PDF usando la fecha original (issuedAt) guardada
      expect(mockPdfGenerator.execute).toHaveBeenCalledWith({
        tripId: 'trip-resend-001',
        passengerEmail: 'pasajero.original@test.com',
        amount: 3800,
        currency: 'ARS',
        driverName: 'Conductor Asignado',
        issuedAt: mockOriginalDate, // Preservada estrictamente
      });

      // 4. Debe enviar el correo con el archivo adjunto formateado con el receiptCode
      expect(mockNotificationsService.send).toHaveBeenCalledWith({
        channel: NotificationChannelDto.EMAIL,
        recipient: 'destino.reenvio@test.com',
        subject: 'Comprobante de Viaje #REC-2026-A1B2C3',
        content: expect.stringContaining('REC-2026-A1B2C3'),
        referenceId: 'trip-resend-001',
        referenceType: 'TRIP',
        attachments: [
          {
            filename: 'comprobante-REC-2026-A1B2C3.pdf',
            content: Buffer.from(mockPdfBytes),
            contentType: 'application/pdf',
          },
        ],
      });

      // 5. Debe retornar éxito con los datos del comprobante
      expect(result).toEqual({
        success: true,
        tripId: 'trip-resend-001',
        receiptCode: 'REC-2026-A1B2C3',
        sentTo: 'destino.reenvio@test.com',
        timestamp: expect.any(String),
      });
    });
  });

  describe('2. Comprobante inexistente (404)', () => {
    it('debe lanzar NotFoundException si no existe el comprobante, sin regenerar PDF ni enviar correo', async () => {
      mockReceiptRepo.findByTripId.mockResolvedValue(null);

      await expect(useCase.execute(dto)).rejects.toThrow(NotFoundException);

      // Verificación de que no se ejecutó generación ni envío
      expect(mockPdfGenerator.execute).not.toHaveBeenCalled();
      expect(mockNotificationsService.send).not.toHaveBeenCalled();
      expect(mockReceiptRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('3. Fallo en el servicio de correo (502 / No informar éxito falso)', () => {
    it('debe lanzar BadGatewayException si el envío del correo reporta fallo', async () => {
      mockReceiptRepo.findByTripId.mockResolvedValue(mockReceipt);
      mockNotificationsService.send!.mockResolvedValue({
        success: false,
        id: 'log-fail',
        status: NotificationStatus.FAILED,
      });

      await expect(useCase.execute(dto)).rejects.toThrow(BadGatewayException);

      // Verificación de que no se mutó el repositorio
      expect(mockReceiptRepo.save).not.toHaveBeenCalled();
    });
  });
});
