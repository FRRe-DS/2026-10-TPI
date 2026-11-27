import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { EventsController, EventoEntradaDto } from './events.controller';
import { NotificationsService } from '../notifications/application/notifications.service';
import { IssueReceiptUseCase } from '../documents/application/use-cases/issue-receipt.use-case';

describe('EventsController (POST /api/v1/eventos - RF-8.1, RF-8.2, RF-8.4, RF-8.8)', () => {
  let controller: EventsController;
  let notificationsService: { send: jest.Mock };
  let issueReceiptUseCase: { execute: jest.Mock };

  const samplePdfBuffer = Buffer.from('%PDF-1.3\ncontenido\n%%EOF\n', 'latin1');

  beforeEach(async () => {
    notificationsService = {
      send: jest.fn().mockResolvedValue({
        success: true,
        id: 'notif-uuid-1',
        status: 'SENT',
      }),
    };

    issueReceiptUseCase = {
      execute: jest.fn().mockResolvedValue({
        receipt: {
          id: 'rec-uuid-1',
          receiptCode: 'REC-2026-00001',
          tripId: 'trip-uuid-1001',
          passengerId: 'usr-uuid-3003',
          passengerEmail: 'pasajero@ejemplo.com',
          amount: 4500,
          currency: 'ARS',
          issuedAt: new Date('2026-10-27T15:30:00.000Z'),
        },
        pdf: samplePdfBuffer,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        { provide: NotificationsService, useValue: notificationsService },
        { provide: IssueReceiptUseCase, useValue: issueReceiptUseCase },
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

  it('debe procesar VIAJE_FINALIZADO, generar automáticamente el PDF del comprobante, adjuntarlo al correo y responder 202', async () => {
    const dto = buildValidEvent();
    const res = await controller.recibirEvento(dto);

    expect(res).toEqual({
      eventoId: dto.eventoId,
      recibidoEn: expect.any(String),
    });

    expect(issueReceiptUseCase.execute).toHaveBeenCalledWith({
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
        attachments: [
          {
            filename: 'comprobante-REC-2026-00001.pdf',
            content: samplePdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      }),
      dto.eventoId,
    );
  });

  it('genera el PDF automáticamente aun cuando el canal preferido del pasajero no sea EMAIL', async () => {
    const dto = buildValidEvent({
      destinatarios: [
        {
          usuarioId: 'usr-uuid-3003',
          rol: 'CLIENTE',
          telefono: '+5493624000000',
          canalesPreferidos: ['SMS'],
        },
      ],
    });

    await controller.recibirEvento(dto);

    expect(issueReceiptUseCase.execute).toHaveBeenCalledTimes(1);
    expect(notificationsService.send).toHaveBeenCalledWith(
      expect.not.objectContaining({ attachments: expect.anything() }),
      dto.eventoId,
    );
  });

  it('debe garantizar idempotencia devolviendo la respuesta original si se repite el mismo eventoId con idéntico cuerpo (RNF-09)', async () => {
    const dto = buildValidEvent();
    const first = await controller.recibirEvento(dto);
    const second = await controller.recibirEvento(dto);

    expect(second).toEqual(first);
    expect(issueReceiptUseCase.execute).toHaveBeenCalledTimes(1);
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

  it('cuando llegan VIAJE_FINALIZADO y PAGO_CAPTURADO del mismo viaje no duplica comprobantes, no reenvía el PDF dos veces ni repite un mismo hito terminal', async () => {
    const finDto = buildValidEvent({
      eventoId: 'evt-fin-1',
      tipo: 'VIAJE_FINALIZADO',
      origen: 'M6',
      viajeId: 'trip-combo-1',
    });
    const finDuplicadoConOtroEventoId = buildValidEvent({
      eventoId: 'evt-fin-duplicado-2',
      tipo: 'VIAJE_FINALIZADO',
      origen: 'M6',
      viajeId: 'trip-combo-1',
    });
    const pagoDto = buildValidEvent({
      eventoId: 'evt-pago-1',
      tipo: 'PAGO_CAPTURADO',
      origen: 'M7',
      viajeId: 'trip-combo-1',
      pagoId: 'pay-combo-1',
    });

    await controller.recibirEvento(finDto);
    await controller.recibirEvento(finDuplicadoConOtroEventoId);
    await controller.recibirEvento(pagoDto);

    // El VIAJE_FINALIZADO duplicado con otro eventoId se filtra como hito terminal ya procesado.
    expect(notificationsService.send).toHaveBeenCalledTimes(2);
    // Primer aviso (VIAJE_FINALIZADO): incluye el adjunto PDF.
    expect(notificationsService.send.mock.calls[0][0].attachments).toHaveLength(1);
    // Segundo aviso (PAGO_CAPTURADO): aviso distinto de pago, sin volver a adjuntar el PDF ya entregado.
    expect(notificationsService.send.mock.calls[1][0].subject).toBe('Confirmación de pago recibido');
    expect(notificationsService.send.mock.calls[1][0].attachments).toBeUndefined();
  });

  it('si VIAJE_FINALIZADO no trae importe no inventa monto falso y PAGO_CAPTURADO emite el comprobante con el monto real', async () => {
    await controller.recibirEvento(
      buildValidEvent({
        eventoId: 'evt-sin-importe',
        tipo: 'VIAJE_FINALIZADO',
        origen: 'M6',
        viajeId: 'trip-m7-amount',
        detalle: { origen: 'Centro', destino: 'UTN' },
      }),
    );

    expect(issueReceiptUseCase.execute).not.toHaveBeenCalled();
    expect(notificationsService.send).toHaveBeenCalledTimes(1);

    await controller.recibirEvento(
      buildValidEvent({
        eventoId: 'evt-con-importe-m7',
        tipo: 'PAGO_CAPTURADO',
        origen: 'M7',
        viajeId: 'trip-m7-amount',
        pagoId: 'pay-m7-amount',
        detalle: { importe: { monto: 6200, moneda: 'ARS' } },
      }),
    );

    expect(issueReceiptUseCase.execute).toHaveBeenCalledTimes(1);
    expect(issueReceiptUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: 'trip-m7-amount', amount: 6200, currency: 'ARS' }),
    );
    expect(notificationsService.send.mock.calls[1][0].attachments).toHaveLength(1);
  });

  it('si PDFKit falla en VIAJE_FINALIZADO el evento queda procesado y PAGO_CAPTURADO recupera el adjunto PDF', async () => {
    issueReceiptUseCase.execute
      .mockResolvedValueOnce({
        receipt: {
          id: 'rec-uuid-1',
          receiptCode: 'REC-2026-00001',
          tripId: 'trip-recover-1',
          passengerId: 'usr-uuid-3003',
          passengerEmail: 'pasajero@ejemplo.com',
          amount: 4500,
          currency: 'ARS',
          issuedAt: new Date('2026-10-27T15:30:00.000Z'),
        },
        pdf: null,
        pdfError: 'Error transitorio en PDFKit',
      })
      .mockResolvedValueOnce({
        receipt: {
          id: 'rec-uuid-1',
          receiptCode: 'REC-2026-00001',
          tripId: 'trip-recover-1',
          passengerId: 'usr-uuid-3003',
          passengerEmail: 'pasajero@ejemplo.com',
          amount: 4500,
          currency: 'ARS',
          issuedAt: new Date('2026-10-27T15:30:00.000Z'),
        },
        pdf: samplePdfBuffer,
      });

    const finDto = buildValidEvent({
      eventoId: 'evt-pdf-fail-1',
      tipo: 'VIAJE_FINALIZADO',
      viajeId: 'trip-recover-1',
    });
    const firstRes = await controller.recibirEvento(finDto);
    const repeatRes = await controller.recibirEvento(finDto);

    // Queda marcado como procesado: repetir el evento no vuelve a disparar avisos.
    expect(repeatRes).toEqual(firstRes);
    expect(notificationsService.send).toHaveBeenCalledTimes(1);
    expect(notificationsService.send.mock.calls[0][0].attachments).toBeUndefined();

    // Al llegar PAGO_CAPTURADO con PDFKit operativo, se adjunta el PDF recuperado.
    await controller.recibirEvento(
      buildValidEvent({
        eventoId: 'evt-pago-recover-2',
        tipo: 'PAGO_CAPTURADO',
        origen: 'M7',
        viajeId: 'trip-recover-1',
        pagoId: 'pay-recover-1',
      }),
    );
    expect(notificationsService.send).toHaveBeenCalledTimes(2);
    expect(notificationsService.send.mock.calls[1][0].attachments).toHaveLength(1);
  });
});
