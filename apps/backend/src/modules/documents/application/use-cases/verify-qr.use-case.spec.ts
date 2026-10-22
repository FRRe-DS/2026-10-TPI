import { VerifyQrUseCase } from './verify-qr.use-case';
import { QrTokenRepositoryPort, QrTokenRecord } from '../../domain/ports/qr-token.repository.port';
import { RedisService } from '../../../../common/redis.service';
import { BadRequestException, GoneException, NotFoundException } from '@nestjs/common';

describe('VerifyQrUseCase (Unit Tests)', () => {
  let useCase: VerifyQrUseCase;
  let mockRepo: jest.Mocked<QrTokenRepositoryPort>;
  let mockRedis: jest.Mocked<RedisService>;

  beforeEach(() => {
    mockRepo = {
      save: jest.fn(),
      findByToken: jest.fn(),
      markAsUsed: jest.fn(),
    };

    mockRedis = {
      set: jest.fn(),
      get: jest.fn(),
      getDel: jest.fn().mockResolvedValue('value'),
      del: jest.fn(),
    } as any;

    useCase = new VerifyQrUseCase(mockRepo, mockRedis);
  });

  it('debe validar y consumir exitosamente un token válido', async () => {
    const validRecord: QrTokenRecord = {
      id: 'uuid-1',
      token: 'qr_trip-1_valid',
      tripId: 'trip-1',
      passengerId: 'pass-1',
      isUsed: false,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
    };

    mockRepo.findByToken.mockResolvedValue(validRecord);
    mockRepo.markAsUsed.mockResolvedValue(true);

    const result = await useCase.execute({
      token: 'qr_trip-1_valid',
      tripId: 'trip-1',
    });

    expect(result.valid).toBe(true);
    expect(result.tripId).toBe('trip-1');
    expect(result.token).toBe('qr_trip-1_valid');
    expect(mockRepo.markAsUsed).toHaveBeenCalledWith('qr_trip-1_valid', expect.any(Date));
    expect(mockRedis.getDel).toHaveBeenCalledWith('qr:qr_trip-1_valid');
  });

  it('debe lanzar GoneException si markAsUsed retorna false (competencia por consumo atómico - RNF-08)', async () => {
    const validRecord: QrTokenRecord = {
      id: 'uuid-1',
      token: 'qr_trip-race_token',
      tripId: 'trip-race',
      passengerId: 'pass-1',
      isUsed: false,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
    };

    mockRepo.findByToken.mockResolvedValue(validRecord);
    // Simula que otra solicitud concurrente ya consumió el registro
    mockRepo.markAsUsed.mockResolvedValue(false);

    await expect(
      useCase.execute({
        token: 'qr_trip-race_token',
        tripId: 'trip-race',
      }),
    ).rejects.toThrow(GoneException);
  });

  it('debe lanzar NotFoundException si el token no existe', async () => {
    mockRepo.findByToken.mockResolvedValue(null);
    mockRedis.get.mockResolvedValue(null);

    await expect(
      useCase.execute({
        token: 'qr_non_existent',
        tripId: 'trip-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('debe lanzar BadRequestException si el tripId no coincide', async () => {
    const record: QrTokenRecord = {
      id: 'uuid-1',
      token: 'qr_trip-1_token',
      tripId: 'trip-1',
      passengerId: 'pass-1',
      isUsed: false,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
    };

    mockRepo.findByToken.mockResolvedValue(record);

    await expect(
      useCase.execute({
        token: 'qr_trip-1_token',
        tripId: 'trip-different',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
