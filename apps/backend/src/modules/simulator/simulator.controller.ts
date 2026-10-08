import { Controller, Post, Body, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { NotificationsService } from '../notifications/application/notifications.service';
import { DocumentsService } from '../documents/application/documents.service';
import { NotificationChannelDto } from '../notifications/application/dto/send-notification.dto';

@ApiTags('Simulador de Eventos')
@Controller('simulator')
export class SimulatorController {
  private readonly logger = new Logger(SimulatorController.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly documentsService: DocumentsService,
  ) { }

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

    await this.notificationsService.send({
      channel: NotificationChannelDto.EMAIL,
      recipient: email,
      subject: `¡Viaje Finalizado! Comprobante de Viaje #${tripId}`,
      content: `Hola! Tu viaje con ${driver} ha finalizado. El total abonado fue de $${fare}. Podés consultar y descargar tu comprobante digital en el portal.`,
      referenceId: tripId,
      referenceType: 'TRIP',
    });

    return {
      simulated: true,
      event: 'trip.completed',
      tripId,
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
}
