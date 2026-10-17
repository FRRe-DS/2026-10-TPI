import { PrismaReceiptRepository } from './prisma-receipt.repository';
import { PrismaService } from '../../../../common/prisma.service';
import { ReceiptData } from '../../domain/ports/receipt.repository.port';
import { Prisma } from '@prisma/client';

describe('PrismaReceiptRepository (Unit Tests con Doble de Prueba)', () => {
  let repository: PrismaReceiptRepository;
  let mockPrisma: any;
  let mockTx: any;

  const mockDate = new Date('2026-10-16T10:00:00.000Z');

  const baseData: ReceiptData = {
    tripId: 'trip-prisma-001',
    passengerId: 'usr-p-100',
    passengerEmail: 'pasajero@prisma.test',
    amount: 4200,
    currency: 'ARS',
    driverName: 'Conductor Test',
  };

  beforeEach(() => {
    mockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      documentReceipt: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };

    mockPrisma = {
      $transaction: jest.fn().mockImplementation((cb: (tx: any) => Promise<any>) => cb(mockTx)),
      documentReceipt: {
        findFirst: jest.fn(),
      },
    };

    repository = new PrismaReceiptRepository(mockPrisma as unknown as PrismaService);
  });

  describe('save', () => {
    it('debe ejecutar una transacción interactiva y adquirir el advisory lock para el tripId', async () => {
      mockTx.documentReceipt.findFirst.mockResolvedValue(null);
      mockTx.documentReceipt.create.mockResolvedValue({
        id: 'rec-1',
        receiptCode: 'REC-2026-X1Y2Z3',
        tripId: baseData.tripId,
        passengerId: baseData.passengerId,
        amount: { toString: () => '4200' },
        currency: 'ARS',
        metadata: { passengerEmail: baseData.passengerEmail, driverName: baseData.driverName },
        createdAt: mockDate,
      });

      const result = await repository.save(baseData);

      // 1. Debe envolver en transacción
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

      // 2. Debe ejecutar el bloqueo consultivo atómico
      expect(mockTx.$executeRaw).toHaveBeenCalled();

      // 3. Debe crear el registro
      expect(mockTx.documentReceipt.create).toHaveBeenCalled();
      expect(result.receiptCode).toBe('REC-2026-X1Y2Z3');
      expect(result.amount).toBe(4200);
      expect(result.issuedAt).toBe(mockDate);
    });

    it('debe devolver el registro existente y NO llamar a create si ya existe un comprobante para el tripId', async () => {
      mockTx.documentReceipt.findFirst.mockResolvedValue({
        id: 'rec-existente',
        receiptCode: 'REC-2026-EXIST01',
        tripId: baseData.tripId,
        passengerId: baseData.passengerId,
        amount: { toString: () => '4200' },
        currency: 'ARS',
        metadata: { passengerEmail: baseData.passengerEmail, driverName: baseData.driverName },
        createdAt: mockDate,
      });

      const result = await repository.save(baseData);

      expect(mockTx.$executeRaw).toHaveBeenCalled();
      expect(mockTx.documentReceipt.findFirst).toHaveBeenCalledWith({
        where: { tripId: baseData.tripId },
      });
      // NO debe crear nada nuevo (idempotencia)
      expect(mockTx.documentReceipt.create).not.toHaveBeenCalled();
      expect(result.id).toBe('rec-existente');
      expect(result.receiptCode).toBe('REC-2026-EXIST01');
    });

    it('debe reintentar la transacción completa desde cero ante un error P2002 en receiptCode', async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`receiptCode`)',
        {
          code: 'P2002',
          clientVersion: '5.x',
          meta: { target: ['receiptCode'] },
        },
      );

      mockTx.documentReceipt.findFirst.mockResolvedValue(null);

      // Primer intento: colisión P2002 en receiptCode
      // Segundo intento: create exitoso con nuevo código
      mockTx.documentReceipt.create
        .mockRejectedValueOnce(p2002Error)
        .mockResolvedValueOnce({
          id: 'rec-retry-success',
          receiptCode: 'REC-2026-NEW02',
          tripId: baseData.tripId,
          passengerId: baseData.passengerId,
          amount: { toString: () => '4200' },
          currency: 'ARS',
          metadata: { passengerEmail: baseData.passengerEmail },
          createdAt: mockDate,
        });

      const result = await repository.save(baseData);

      // Debe haber iniciado una nueva transacción en el reintento
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
      expect(result.id).toBe('rec-retry-success');
      expect(result.receiptCode).toBe('REC-2026-NEW02');
    });

    it('debe relanzar el error sin reintentar si el fallo no es una colisión de receiptCode', async () => {
      const genericError = new Error('Database connection lost');
      mockTx.documentReceipt.findFirst.mockResolvedValue(null);
      mockTx.documentReceipt.create.mockRejectedValue(genericError);

      await expect(repository.save(baseData)).rejects.toThrow('Database connection lost');

      // Solo 1 intento, no reintenta errores que no sean P2002 de receiptCode
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('debe fallar tras alcanzar el límite de 3 intentos si persiste la colisión P2002', async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`receiptCode`)',
        {
          code: 'P2002',
          clientVersion: '5.x',
          meta: { target: ['receiptCode'] },
        },
      );

      mockTx.documentReceipt.findFirst.mockResolvedValue(null);
      mockTx.documentReceipt.create.mockRejectedValue(p2002Error);

      await expect(repository.save(baseData)).rejects.toThrow(Prisma.PrismaClientKnownRequestError);

      // Exactamente 3 intentos máximos
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3);
    });
  });

  describe('findByTripId', () => {
    it('debe buscar por tripId y devolver null si no existe', async () => {
      mockPrisma.documentReceipt.findFirst.mockResolvedValue(null);

      const result = await repository.findByTripId('trip-inexistente');

      expect(mockPrisma.documentReceipt.findFirst).toHaveBeenCalledWith({
        where: { tripId: 'trip-inexistente' },
      });
      expect(result).toBeNull();
    });

    it('debe mapear correctamente los campos y la fecha original al encontrar un registro', async () => {
      mockPrisma.documentReceipt.findFirst.mockResolvedValue({
        id: 'rec-found',
        receiptCode: 'REC-2026-FOUND01',
        tripId: 'trip-prisma-001',
        passengerId: 'usr-p-100',
        amount: { toString: () => '5100.75' },
        currency: 'ARS',
        metadata: { passengerEmail: 'email@test.com', driverName: 'Driver X' },
        createdAt: mockDate,
      });

      const result = await repository.findByTripId('trip-prisma-001');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('rec-found');
      expect(result!.amount).toBe(5100.75);
      expect(result!.driverName).toBe('Driver X');
      expect(result!.issuedAt).toBe(mockDate);
    });
  });
});
