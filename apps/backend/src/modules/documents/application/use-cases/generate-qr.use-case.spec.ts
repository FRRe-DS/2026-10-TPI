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

  it('debe generar un QR con token válido, persistir en repo e indexar trip:{viajeId}:active_token en Redis', async () => {
    mockRedis.get.mockResolvedValue(null);

    const result = await useCase.execute({
      tripId: 'trip-abc',
      passengerId: 'pass-xyz',
      ttlSeconds: 120,
    });

    expect(result.tripId).toBe('trip-abc');
    expect(result.token).toMatch(/^qr_trip-abc_/);
    expect(result.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.ttlSeconds).toBe(120);

    expect(mockRedis.get).toHaveBeenCalledWith('trip:trip-abc:active_token');
    expect(mockRedis.set).toHaveBeenCalledWith(
      `qr:${result.token}`,
      expect.stringContaining('"estado":"VIGENTE"'),
      120,
    );
    expect(mockRedis.set).toHaveBeenCalledWith(
      'trip:trip-abc:active_token',
      result.token,
      120,
    );
    expect(mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: 'trip-abc',
        passengerId: 'pass-xyz',
        isUsed: false,
      }),
    );
  });

  it('debe marcar el QR previo como REEMPLAZADO en Redis cuando ya existía un active_token VIGENTE para el mismo viaje', async () => {
    const oldToken = 'qr_trip-abc_oldtoken123';
    const oldPayload = JSON.stringify({
      token: oldToken,
      tripId: 'trip-abc',
      passengerId: 'pass-xyz',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      isUsed: false,
      estado: 'VIGENTE',
    });

    mockRedis.get.mockImplementation(async (key: string) => {
      if (key === 'trip:trip-abc:active_token') return oldToken;
      if (key === `qr:${oldToken}`) return oldPayload;
      return null;
    });

    const result = await useCase.execute({
      tripId: 'trip-abc',
      passengerId: 'pass-xyz',
      ttlSeconds: 300,
    });

    expect(result.token).not.toBe(oldToken);

    // Verifica que el token anterior haya pasado a estado REEMPLAZADO en Redis
    expect(mockRedis.set).toHaveBeenCalledWith(
      `qr:${oldToken}`,
      expect.stringContaining('"estado":"REEMPLAZADO"'),
      300,
    );

    // Verifica que el nuevo token se guarde como VIGENTE y actualice trip:{viajeId}:active_token
    expect(mockRedis.set).toHaveBeenCalledWith(
      `qr:${result.token}`,
      expect.stringContaining('"estado":"VIGENTE"'),
      300,
    );
    expect(mockRedis.set).toHaveBeenCalledWith(
      'trip:trip-abc:active_token',
      result.token,
      300,
    );
  });
});
