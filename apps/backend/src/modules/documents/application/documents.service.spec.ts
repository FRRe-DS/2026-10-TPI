import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, GoneException, BadRequestException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { RedisService } from '../../../common/redis.service';
import { PrismaService } from '../../../common/prisma.service';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { RECEIPT_REPOSITORY_PORT } from '../domain/ports/receipt.repository.port';
import { ResendReceiptUseCase } from './use-cases/resend-receipt.use-case';

describe('DocumentsService - RF-8.3 Generador y Validador de QR', () => {
  let service: DocumentsService;
  let redisService: RedisService;
  let prismaService: PrismaService;

  const mockRedisStorage = new Map<string, string>();

  const mockRedisService = {
    set: jest.fn().mockImplementation(async (key: string, value: string, _ttl: number) => {
      mockRedisStorage.set(key, value);
    }),
    get: jest.fn().mockImplementation(async (key: string) => {
      return mockRedisStorage.get(key) || null;
    }),
    del: jest.fn().mockImplementation(async (key: string) => {
      mockRedisStorage.delete(key);
    }),
  };

  const mockPrismaDb = new Map<string, any>();

  const mockPrismaService = {
    qrVerificationToken: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        mockPrismaDb.set(data.token, {
          ...data,
          id: 'token-uuid-' + Date.now(),
          createdAt: new Date(),
        });
        return mockPrismaDb.get(data.token);
      }),
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        return mockPrismaDb.get(where.token) || null;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const existing = mockPrismaDb.get(where.token);
        if (existing) {
          const updated = { ...existing, ...data };
          mockPrismaDb.set(where.token, updated);
          return updated;
        }
        return null;
      }),
    },
  };

  const mockNotificationsService = {
    send: jest.fn().mockResolvedValue({ success: true }),
  };

  const mockReceiptRepo = {
    findByTripId: jest.fn(),
    create: jest.fn(),
  };

  const mockResendReceiptUseCase = {
    execute: jest.fn(),
  };

  beforeEach(async () => {
    mockRedisStorage.clear();
    mockPrismaDb.clear();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: RedisService, useValue: mockRedisService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: RECEIPT_REPOSITORY_PORT, useValue: mockReceiptRepo },
        { provide: ResendReceiptUseCase, useValue: mockResendReceiptUseCase },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
    redisService = module.get<RedisService>(RedisService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('generateQr', () => {
    it('debe generar un token único, dataURL en base64 y almacenar en Redis y Supabase (Prisma)', async () => {
      const dto = {
        tripId: 'trip-12345',
        passengerId: 'pass-999',
        ttlSeconds: 300,
      };

      const result = await service.generateQr(dto);

      expect(result).toBeDefined();
      expect(result.token).toMatch(/^qr_trip-12345_/);
      expect(result.tripId).toBe('trip-12345');
      expect(result.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(result.ttlSeconds).toBe(300);
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());

      expect(mockRedisService.set).toHaveBeenCalledWith(
        `qr:${result.token}`,
        expect.stringContaining(result.token),
        300,
      );

      expect(mockPrismaService.qrVerificationToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          token: result.token,
          tripId: 'trip-12345',
          passengerId: 'pass-999',
          isUsed: false,
        }),
      });
    });

    it('debe usar TTL por defecto de 300 segundos si no se proporciona ttlSeconds', async () => {
      const dto = {
        tripId: 'trip-default-ttl',
        passengerId: 'pass-111',
      };

      const result = await service.generateQr(dto);

      expect(result.ttlSeconds).toBe(300);
      expect(mockRedisService.set).toHaveBeenCalledWith(
        `qr:${result.token}`,
        expect.any(String),
        300,
      );
    });

    it('debe funcionar con fallback si la base de datos no está disponible', async () => {
      mockPrismaService.qrVerificationToken.create.mockRejectedValueOnce(
        new Error('Connection error'),
      );

      const dto = {
        tripId: 'trip-fallback',
        passengerId: 'pass-222',
      };

      const result = await service.generateQr(dto);

      expect(result.token).toBeDefined();
      expect(result.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(mockRedisService.set).toHaveBeenCalled();
    });
  });

  describe('verifyQr', () => {
    it('debe validar y consumir exitosamente un código QR válido (marcar isUsed: true y eliminar de Redis)', async () => {
      const generated = await service.generateQr({
        tripId: 'trip-valid-1',
        passengerId: 'pass-100',
        ttlSeconds: 300,
      });

      const verifyResult = await service.verifyQr({
        token: generated.token,
        tripId: 'trip-valid-1',
      });

      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.tripId).toBe('trip-valid-1');
      expect(verifyResult.token).toBe(generated.token);
      expect(verifyResult.verifiedAt).toBeDefined();

      expect(mockPrismaService.qrVerificationToken.update).toHaveBeenCalledWith({
        where: { token: generated.token },
        data: expect.objectContaining({
          isUsed: true,
          usedAt: expect.any(Date),
        }),
      });

      expect(mockRedisService.del).toHaveBeenCalledWith(`qr:${generated.token}`);
    });

    it('debe rechazar con GoneException (410) si el token ya fue utilizado', async () => {
      const generated = await service.generateQr({
        tripId: 'trip-single-use',
        passengerId: 'pass-100',
        ttlSeconds: 300,
      });

      await service.verifyQr({
        token: generated.token,
        tripId: 'trip-single-use',
      });

      await expect(
        service.verifyQr({
          token: generated.token,
          tripId: 'trip-single-use',
        }),
      ).rejects.toThrow(GoneException);
    });

    it('debe rechazar con GoneException (410) si el token ya expiró', async () => {
      const expiredToken = 'qr_trip-expired_abc123';
      mockPrismaDb.set(expiredToken, {
        token: expiredToken,
        tripId: 'trip-expired',
        passengerId: 'pass-100',
        expiresAt: new Date(Date.now() - 60000),
        isUsed: false,
      });

      await expect(
        service.verifyQr({
          token: expiredToken,
          tripId: 'trip-expired',
        }),
      ).rejects.toThrow(GoneException);
    });

    it('debe rechazar con NotFoundException (404) si el token no existe', async () => {
      await expect(
        service.verifyQr({
          token: 'token-inexistente',
          tripId: 'trip-any',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe rechazar con BadRequestException (400) si el tripId no corresponde al token', async () => {
      const generated = await service.generateQr({
        tripId: 'trip-real-1',
        passengerId: 'pass-100',
        ttlSeconds: 300,
      });

      await expect(
        service.verifyQr({
          token: generated.token,
          tripId: 'trip-equivocado-99',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
