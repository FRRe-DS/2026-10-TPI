import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  GoneException,
  BadRequestException,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { GenerateQrUseCase } from './use-cases/generate-qr.use-case';
import { VerifyQrUseCase } from './use-cases/verify-qr.use-case';
import { ResendReceiptUseCase } from './use-cases/resend-receipt.use-case';
import {
  RECEIPT_REPOSITORY_PORT,
  ReceiptRepositoryPort,
} from '../domain/ports/receipt.repository.port';
import {
  QR_TOKEN_REPOSITORY_PORT,
  QrTokenRepositoryPort,
  QrTokenData,
  QrTokenRecord,
} from '../domain/ports/qr-token.repository.port';
import { RedisService } from '../../../common/redis.service';

describe('DocumentsService - Fachada y Casos de Uso QR (RF-8.3 / RNF-08)', () => {
  let service: DocumentsService;
  let mockRedisService: any;
  let mockQrTokenRepo: QrTokenRepositoryPort;

  const mockRedisStorage = new Map<string, string>();
  const mockTokensDb = new Map<string, QrTokenRecord>();

  beforeEach(async () => {
    mockRedisStorage.clear();
    mockTokensDb.clear();
    jest.clearAllMocks();

    mockRedisService = {
      set: jest.fn().mockImplementation(async (key: string, value: string) => {
        mockRedisStorage.set(key, value);
      }),
      get: jest.fn().mockImplementation(async (key: string) => {
        return mockRedisStorage.get(key) || null;
      }),
      getDel: jest.fn().mockImplementation(async (key: string) => {
        const val = mockRedisStorage.get(key) || null;
        mockRedisStorage.delete(key);
        return val;
      }),
      del: jest.fn().mockImplementation(async (key: string) => {
        mockRedisStorage.delete(key);
      }),
    };

    mockQrTokenRepo = {
      save: jest.fn().mockImplementation(async (data: QrTokenData): Promise<QrTokenRecord> => {
        const record: QrTokenRecord = {
          id: 'token-uuid-' + Date.now(),
          token: data.token,
          tripId: data.tripId,
          passengerId: data.passengerId,
          isUsed: data.isUsed ?? false,
          usedAt: null,
          expiresAt: data.expiresAt,
          createdAt: new Date(),
        };
        mockTokensDb.set(data.token, record);
        return record;
      }),
      findByToken: jest.fn().mockImplementation(async (token: string): Promise<QrTokenRecord | null> => {
        const item = mockTokensDb.get(token);
        return item ? { ...item } : null;
      }),
      markAsUsed: jest.fn().mockImplementation(async (token: string, usedAt?: Date): Promise<boolean> => {
        const item = mockTokensDb.get(token);
        if (!item || item.isUsed) {
          return false;
        }
        item.isUsed = true;
        item.usedAt = usedAt || new Date();
        return true;
      }),
    };

    const mockReceiptRepo: Partial<ReceiptRepositoryPort> = {
      findByTripId: jest.fn(),
      save: jest.fn(),
    };

    const mockResendReceiptUseCase = {
      execute: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        {
          provide: QR_TOKEN_REPOSITORY_PORT,
          useValue: mockQrTokenRepo,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
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
        {
          provide: RECEIPT_REPOSITORY_PORT,
          useValue: mockReceiptRepo,
        },
        {
          provide: ResendReceiptUseCase,
          useValue: mockResendReceiptUseCase,
        },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('generateQr', () => {
    it('debe generar un token único, dataURL en base64 y almacenar en Redis y repositorio', async () => {
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

      expect(mockQrTokenRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          token: result.token,
          tripId: 'trip-12345',
          passengerId: 'pass-999',
          isUsed: false,
        }),
      );
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
  });

  describe('verifyQr', () => {
    it('debe validar y consumir exitosamente un código QR válido (marcar isUsed y eliminar de Redis)', async () => {
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

      expect(mockQrTokenRepo.markAsUsed).toHaveBeenCalledWith(
        generated.token,
        expect.any(Date),
      );
      expect(mockRedisService.getDel).toHaveBeenCalledWith(`qr:${generated.token}`);
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
      mockTokensDb.set(expiredToken, {
        id: 'token-exp',
        token: expiredToken,
        tripId: 'trip-expired',
        passengerId: 'pass-100',
        expiresAt: new Date(Date.now() - 60000),
        isUsed: false,
        usedAt: null,
        createdAt: new Date(Date.now() - 120000),
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

    it('debe garantizar consumo atómico ante peticiones simultáneas con Promise.all (solo 1 retorna 200 OK y la segunda lanza 410 Gone - RNF-08)', async () => {
      const generated = await service.generateQr({
        tripId: 'trip-concurrency-test',
        passengerId: 'pass-concurrent',
        ttlSeconds: 300,
      });

      // Dos invocaciones concurrentes exactas con Promise.allSettled
      const [result1, result2] = await Promise.allSettled([
        service.verifyQr({
          token: generated.token,
          tripId: 'trip-concurrency-test',
        }),
        service.verifyQr({
          token: generated.token,
          tripId: 'trip-concurrency-test',
        }),
      ]);

      const fulfilled = [result1, result2].filter((r) => r.status === 'fulfilled');
      const rejected = [result1, result2].filter((r) => r.status === 'rejected');

      // Exactamente una debe haber triunfado y exactamente una debe haber fallado
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      if (fulfilled[0].status === 'fulfilled') {
        expect(fulfilled[0].value.valid).toBe(true);
        expect(fulfilled[0].value.tripId).toBe('trip-concurrency-test');
      }

      if (rejected[0].status === 'rejected') {
        expect(rejected[0].reason).toBeInstanceOf(GoneException);
        expect((rejected[0].reason as GoneException).getStatus()).toBe(410);
      }
    });
  });
});
