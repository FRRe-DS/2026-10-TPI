import { VerifyQrUseCase } from './verify-qr.use-case';
import { QrTokenRepositoryPort, QrTokenRecord } from '../../domain/ports/qr-token.repository.port';
import { RedisService } from '../../../../common/redis.service';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';

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

  it('debe lanzar ConflictException (409 /errores/qr-reemplazado) si el token en Redis tiene estado REEMPLAZADO', async () => {
    const oldRecord: QrTokenRecord = {
      id: 'uuid-old',
      token: 'qr_trip-1_old',
      tripId: 'trip-1',
      passengerId: 'pass-1',
      isUsed: false,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
    };

    mockRepo.findByToken.mockResolvedValue(oldRecord);
    mockRedis.get.mockImplementation(async (key: string) => {
      if (key === 'qr:qr_trip-1_old') {
        return JSON.stringify({
          token: 'qr_trip-1_old',
          tripId: 'trip-1',
          passengerId: 'pass-1',
          expiresAt: oldRecord.expiresAt.toISOString(),
          isUsed: false,
          estado: 'REEMPLAZADO',
        });
      }
      return null;
    });

    try {
      await useCase.execute({
        token: 'qr_trip-1_old',
        tripId: 'trip-1',
      });
      fail('Debió lanzar ConflictException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getStatus()).toBe(409);
      expect(err.getResponse()).toEqual(
        expect.objectContaining({
          type: '/errores/qr-reemplazado',
          title: 'El QR fue reemplazado',
        }),
      );
    }

    expect(mockRepo.markAsUsed).not.toHaveBeenCalled();
  });

  it('debe lanzar ConflictException (409 /errores/qr-reemplazado) si trip:{viajeId}:active_token en Redis apunta a un token más reciente', async () => {
    const oldRecord: QrTokenRecord = {
      id: 'uuid-old-2',
      token: 'qr_trip-2_old',
      tripId: 'trip-2',
      passengerId: 'pass-1',
      isUsed: false,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
    };

    mockRepo.findByToken.mockResolvedValue(oldRecord);
    mockRedis.get.mockImplementation(async (key: string) => {
      if (key === 'trip:trip-2:active_token') {
        return 'qr_trip-2_newer';
      }
      return null;
    });

    await expect(
      useCase.execute({
        token: 'qr_trip-2_old',
        tripId: 'trip-2',
      }),
    ).rejects.toThrow(ConflictException);

    expect(mockRepo.markAsUsed).not.toHaveBeenCalled();
  });

  it('RNF-19: debe enmascarar el token opaco en los logs de consola al verificar un QR válido', async () => {
    const secretToken = 'qr_trip-priv_0123456789abcdef0123456789abcdef';
    const validRecord: QrTokenRecord = {
      id: 'uuid-priv',
      token: secretToken,
      tripId: 'trip-priv',
      passengerId: 'pass-secret-999',
      isUsed: false,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
    };

    mockRepo.findByToken.mockResolvedValue(validRecord);
    mockRepo.markAsUsed.mockResolvedValue(true);
    const logSpy = jest.spyOn((useCase as any).logger, 'log');

    await useCase.execute({
      token: secretToken,
      tripId: 'trip-priv',
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('token=qr_***_cdef'));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining(secretToken));
  });
});
