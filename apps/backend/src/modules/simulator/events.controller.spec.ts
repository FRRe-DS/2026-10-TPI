import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { EventsController, EventoEntradaDto } from './events.controller';
import { NotificationsService } from '../notifications/application/notifications.service';
import { RegisterReceiptUseCase } from '../documents/application/use-cases/register-receipt.use-case';

describe('EventsController (POST /api/v1/eventos - RF-8.1, RF-8.2, RF-8.4, RF-8.8)', () => {
  let controller: EventsController;
  let notificationsService: { send: jest.Mock };
  let registerReceiptUseCase: { execute: jest.Mock };

  beforeEach(async () => {
    notificationsService = {
      send: jest.fn().mockResolvedValue({
        success: true,
        id: 'notif-uuid-1',
        status: 'SENT',
      }),
    };

    registerReceiptUseCase = {
      execute: jest.fn().mockResolvedValue({
        id: 'rec-uuid-1',
        receiptCode: 'REC-2026-00001',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        { provide: NotificationsService, useValue: notificationsService },
        { provide: RegisterReceiptUseCase, useValue: registerReceiptUseCase },
      ],
    }).compile();

    controller = module.get<EventsController>(EventsController);
  });

  const buildValidEvent = (overrides: Partial<EventoEntradaDto> = {}): EventoEntradaDto => ({
    eventoId: '550e8400-e29b-41d4-a716-446655440000',
    tipo: 'VIAJE_FINALIZADO',
    origen: 'M6',
    ocurridoEn: '2026-10-27T15:30:00.000Z',
    viajeId: 'trip-uuid-1001',
    destinatarios: [
      {
        usuarioId: 'usr-uuid-3003',
        rol: 'CLIENTE',
        email: 'pasajero@ejemplo.com',
        canalesPreferidos: ['EMAIL'],
      },
    ],
    detalle: {
      origen: 'Centro',
      destino: 'Campus UTN',
      importe: { monto: 4500, moneda: 'ARS' },
    },
    ...overrides,
  });

  it('debe procesar un evento VIAJE_FINALIZADO, emitir comprobante, enviar notificación y responder 202 EventoRecibido', async () => {
    const dto = buildValidEvent();
    const res = await controller.recibirEvento(dto);

    expect(res).toEqual({
      eventoId: dto.eventoId,
      recibidoEn: expect.any(String),
    });

    expect(registerReceiptUseCase.execute).toHaveBeenCalledWith({
      tripId: 'trip-uuid-1001',
      passengerId: 'usr-uuid-3003',
      passengerEmail: 'pasajero@ejemplo.com',
      amount: 4500,
      currency: 'ARS',
    });

    expect(notificationsService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        recipient: 'pasajero@ejemplo.com',
        referenceId: 'trip-uuid-1001',
        referenceType: 'TRIP',
      }),
      dto.eventoId,
    );
  });

  it('debe garantizar idempotencia devolviendo la respuesta original si se repite el mismo eventoId con idéntico cuerpo (RNF-09)', async () => {
    const dto = buildValidEvent();
    const first = await controller.recibirEvento(dto);
    const second = await controller.recibirEvento(dto);

    expect(second).toEqual(first);
    expect(registerReceiptUseCase.execute).toHaveBeenCalledTimes(1);
    expect(notificationsService.send).toHaveBeenCalledTimes(1);
  });

  it('debe rechazar con 422 (UnprocessableEntityException) si el mismo eventoId llega con cuerpo diferente', async () => {
    const dto = buildValidEvent();
    await controller.recibirEvento(dto);

    const altered = buildValidEvent({ viajeId: 'trip-otro-999' });
    await expect(controller.recibirEvento(altered)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('debe rechazar con 400 (BadRequestException) si no se incluye viajeId, reservaId ni pagoId', async () => {
    const invalid = buildValidEvent({
      viajeId: undefined,
      reservaId: undefined,
      pagoId: undefined,
    });

    await expect(controller.recibirEvento(invalid)).rejects.toThrow(
      BadRequestException,
    );
  });
});
