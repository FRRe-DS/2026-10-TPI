import { Controller, Post, Body, Logger } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../../common/auth';
import { NotificationsService } from '../notifications/application/notifications.service';
import { DocumentsService } from '../documents/application/documents.service';
import { IssueReceiptUseCase } from '../documents/application/use-cases/issue-receipt.use-case';
import { NotificationChannelDto } from '../notifications/application/dto/send-notification.dto';

@ApiTags('Simulador de Eventos')
@ApiBearerAuth()
@Roles('OPERADOR', 'SERVICIO')
@Controller('simulator')
export class SimulatorController {
  private readonly logger = new Logger(SimulatorController.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly documentsService: DocumentsService,
    private readonly issueReceiptUseCase: IssueReceiptUseCase,
  ) {}

  @Post('trip-completed')
  @ApiOperation({ summary: 'Simular evento M6: Viaje Finalizado (TripCompletedEvent)' })
  @ApiResponse({ status: 201, description: 'Evento simulado procesado en M8' })
  async simulateTripCompleted(
    @Body()
    body: {
      tripId: string;
      passengerEmail: string;
      driverName: string;
      fare: number;
    },
  ) {
    const tripId = body.tripId || `trip-${Date.now()}`;
    const email = body.passengerEmail || 'pasajero.test@movilidad.com';
    const fare = body.fare || 4200.0;
    const driver = body.driverName || 'Martín Conductor';

    this.logger.log(`[SIMULADOR] Evento recibido: trip.completed para viaje ${tripId}`);

    // RF-8.4: Emitir el comprobante (registro idempotente + generación del PDF)
    const issued = await this.issueReceiptUseCase.execute({
      tripId,
      passengerId: `usr-${tripId}`,
      passengerEmail: email,
      amount: fare,
      currency: 'ARS',
      driverName: driver,
    });
    const { receipt } = issued;

    await this.notificationsService.send({
      channel: NotificationChannelDto.EMAIL,
      recipient: email,
      subject: `¡Viaje Finalizado! Comprobante de Viaje #${tripId}`,
      content: `Hola! Tu viaje con ${driver} ha finalizado. El total abonado fue de $${fare}. Podés consultar y descargar tu comprobante digital en el portal.`,
      referenceId: tripId,
      referenceType: 'TRIP',
      ...(issued.pdf
        ? {
            attachments: [
              {
                filename: `comprobante-${receipt.receiptCode}.pdf`,
                content: issued.pdf,
                contentType: 'application/pdf',
              },
            ],
          }
        : {}),
    });

    return {
      simulated: true,
      event: 'trip.completed',
      tripId,
      receiptCode: receipt.receiptCode,
      notificationSentTo: email,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('reservation-confirmed')
  @ApiOperation({ summary: 'Simular evento M9: Reserva Confirmada (ReservationConfirmedEvent)' })
  async simulateReservationConfirmed(
    @Body()
    body: {
      reservationId: string;
      passengerEmail: string;
      scheduledTime: string;
      origin: string;
      destination: string;
    },
  ) {
    const resId = body.reservationId || `res-${Date.now()}`;
    const email = body.passengerEmail || 'pasajero.test@movilidad.com';

    this.logger.log(`[SIMULADOR] Evento recibido: reservation.confirmed para reserva ${resId}`);

    await this.notificationsService.send({
      channel: NotificationChannelDto.EMAIL,
      recipient: email,
      subject: `Reserva #${resId} Confirmada`,
      content: `Tu viaje programado para las ${body.scheduledTime || '18:00'} desde ${body.origin || 'Origen'} hasta ${body.destination || 'Destino'} ha sido confirmado con éxito.`,
      referenceId: resId,
      referenceType: 'RESERVATION',
    });

    return {
      simulated: true,
      event: 'reservation.confirmed',
      reservationId: resId,
      recipient: email,
    };
  }

  @Post('payment-captured')
  @ApiOperation({ summary: 'Simular evento M7: Pago Exitoso (PaymentCapturedEvent)' })
  async simulatePaymentCaptured(
    @Body()
    body: {
      paymentId: string;
      tripId?: string;
      userEmail: string;
      amount: number;
      paymentMethod: string;
    },
  ) {
    const payId = body.paymentId || `pay-${Date.now()}`;
    const email = body.userEmail || 'pasajero.pago@movilidad.com';
    const amount = body.amount || 3850.0;
    const method = body.paymentMethod || 'MERCADOPAGO';
    const tripId = body.tripId || `trip-${Math.floor(1000 + Math.random() * 9000)}`;

    this.logger.log(`[SIMULADOR] Evento recibido: payment.captured para pago ${payId}`);

    const issued = await this.issueReceiptUseCase.execute({
      tripId,
      passengerId: `usr-${tripId}`,
      passengerEmail: email,
      amount,
      currency: 'ARS',
    });

    await this.notificationsService.send({
      channel: NotificationChannelDto.EMAIL,
      recipient: email,
      subject: `Confirmación de Pago #${payId}`,
      content: `Tu pago de $${amount} ARS mediante ${method} fue procesado exitosamente para el servicio #${tripId}.`,
      referenceId: payId,
      referenceType: 'PAYMENT',
      ...(issued.pdf
        ? {
            attachments: [
              {
                filename: `comprobante-${issued.receipt.receiptCode}.pdf`,
                content: issued.pdf,
                contentType: 'application/pdf',
              },
            ],
          }
        : {}),
    });

    return {
      simulated: true,
      event: 'payment.captured',
      paymentId: payId,
      tripId,
      receiptCode: issued.receipt.receiptCode,
      amount,
      paymentMethod: method,
      recipient: email,
      timestamp: new Date().toISOString(),
    };
  }
}
