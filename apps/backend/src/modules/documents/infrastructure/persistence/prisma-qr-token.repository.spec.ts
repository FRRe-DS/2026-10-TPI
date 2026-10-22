import { PrismaQrTokenRepository } from './prisma-qr-token.repository';
import { PrismaService } from '../../../../common/prisma.service';

describe('PrismaQrTokenRepository (Unit Tests con Mock)', () => {
  let repository: PrismaQrTokenRepository;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      qrVerificationToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    repository = new PrismaQrTokenRepository(mockPrisma as unknown as PrismaService);
  });

  it('debe estar definido', () => {
    expect(repository).toBeDefined();
  });

  describe('save', () => {
    it('debe persistir el token en Prisma y retornar el registro', async () => {
      const now = new Date();
      mockPrisma.qrVerificationToken.create.mockResolvedValue({
        id: 'uuid-1',
        token: 'qr_trip-1_abc',
        tripId: 'trip-1',
        passengerId: 'pass-1',
        isUsed: false,
        usedAt: null,
        expiresAt: now,
        createdAt: now,
      });

      const result = await repository.save({
        token: 'qr_trip-1_abc',
        tripId: 'trip-1',
        passengerId: 'pass-1',
        expiresAt: now,
      });

      expect(result.token).toBe('qr_trip-1_abc');
      expect(mockPrisma.qrVerificationToken.create).toHaveBeenCalledWith({
        data: {
          token: 'qr_trip-1_abc',
          tripId: 'trip-1',
          passengerId: 'pass-1',
          expiresAt: now,
          isUsed: false,
        },
      });
    });

    it('debe usar fallback en memoria si Prisma lanza una excepción', async () => {
      mockPrisma.qrVerificationToken.create.mockRejectedValue(new Error('DB unreachable'));
      const now = new Date();

      const result = await repository.save({
        token: 'qr_fallback_token',
        tripId: 'trip-fallback',
        passengerId: 'pass-fb',
        expiresAt: now,
      });

      expect(result).toBeDefined();
      expect(result.token).toBe('qr_fallback_token');

      // Debe poder recuperarse vía findByToken desde la memoria de respaldo
      mockPrisma.qrVerificationToken.findUnique.mockRejectedValue(new Error('DB unreachable'));
      const found = await repository.findByToken('qr_fallback_token');
      expect(found).toBeDefined();
      expect(found?.tripId).toBe('trip-fallback');
    });
  });

  describe('findByToken', () => {
    it('debe retornar el token si existe en Prisma', async () => {
      const now = new Date();
      mockPrisma.qrVerificationToken.findUnique.mockResolvedValue({
        id: 'uuid-1',
        token: 'qr_token_found',
        tripId: 'trip-found',
        passengerId: 'pass-1',
        isUsed: false,
        usedAt: null,
        expiresAt: now,
        createdAt: now,
      });

      const result = await repository.findByToken('qr_token_found');
      expect(result).toBeDefined();
      expect(result?.token).toBe('qr_token_found');
    });

    it('debe retornar null si no existe', async () => {
      mockPrisma.qrVerificationToken.findUnique.mockResolvedValue(null);
      const result = await repository.findByToken('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('markAsUsed', () => {
    it('debe retornar true si updateMany actualizó una fila (count = 1)', async () => {
      mockPrisma.qrVerificationToken.updateMany.mockResolvedValue({ count: 1 });

      const success = await repository.markAsUsed('qr_token_atomic');
      expect(success).toBe(true);
      expect(mockPrisma.qrVerificationToken.updateMany).toHaveBeenCalledWith({
        where: {
          token: 'qr_token_atomic',
          isUsed: false,
        },
        data: {
          isUsed: true,
          usedAt: expect.any(Date),
        },
      });
    });

    it('debe retornar false si updateMany no actualizó filas (count = 0, ya consumido previamente)', async () => {
      mockPrisma.qrVerificationToken.updateMany.mockResolvedValue({ count: 0 });

      const success = await repository.markAsUsed('qr_token_already_used');
      expect(success).toBe(false);
    });
  });
});
