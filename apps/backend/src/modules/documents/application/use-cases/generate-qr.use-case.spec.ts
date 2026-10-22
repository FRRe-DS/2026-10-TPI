import { GenerateQrUseCase } from './generate-qr.use-case';
import { QrTokenRepositoryPort, QrTokenRecord } from '../../domain/ports/qr-token.repository.port';
import { RedisService } from '../../../../common/redis.service';

describe('GenerateQrUseCase (Unit Tests)', () => {
  let useCase: GenerateQrUseCase;
  let mockRepo: jest.Mocked<QrTokenRepositoryPort>;
  let mockRedis: jest.Mocked<RedisService>;

  beforeEach(() => {
    mockRepo = {
      save: jest.fn().mockImplementation(async (data) => ({
        id: 'uuid-1',
        ...data,
        isUsed: false,
        usedAt: null,
        createdAt: new Date(),
      } as QrTokenRecord)),
      findByToken: jest.fn(),
      markAsUsed: jest.fn(),
    };

    mockRedis = {
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      getDel: jest.fn(),
      del: jest.fn(),
    } as any;

    useCase = new GenerateQrUseCase(mockRepo, mockRedis);
  });

  it('debe generar un QR con token válido y persistir en repo y Redis', async () => {
    const result = await useCase.execute({
      tripId: 'trip-abc',
      passengerId: 'pass-xyz',
      ttlSeconds: 120,
    });

    expect(result.tripId).toBe('trip-abc');
    expect(result.token).toMatch(/^qr_trip-abc_/);
    expect(result.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.ttlSeconds).toBe(120);

    expect(mockRedis.set).toHaveBeenCalledWith(`qr:${result.token}`, expect.any(String), 120);
    expect(mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: 'trip-abc',
        passengerId: 'pass-xyz',
        isUsed: false,
      }),
    );
  });
});
