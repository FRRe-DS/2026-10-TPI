import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { EventoEntrada } from '@g10-m8/contracts';
import { isEmail } from 'class-validator';
import {
  ChannelModel,
  ConfirmChannel,
  ConsumeMessage,
} from 'amqplib';
import * as amqp from 'amqplib';
import { NotificationsService } from '../../application/notifications.service';
import { NotificationChannelDto } from '../../application/dto/send-notification.dto';
import { RegisterReceiptUseCase } from '../../../documents/application/use-cases/register-receipt.use-case';

const EVENTO_TIPOS: readonly EventoEntrada['tipo'][] = [
  'VIAJE_SOLICITADO',
  'VIAJE_ASIGNADO',
  'VIAJE_ARRIBO_CONDUCTOR',
  'VIAJE_INICIADO',
  'VIAJE_CANCELADO',
  'VIAJE_FINALIZADO',
  'RESERVA_CREADA',
  'RESERVA_MODIFICADA',
  'RESERVA_CONFIRMADA',
  'RESERVA_RECORDATORIO',
  'RESERVA_ACTIVADA',
  'RESERVA_CANCELADA',
  'RESERVA_VENCIDA',
  'PAGO_CAPTURADO',
  'REINTEGRO_REGISTRADO',
];

const MAX_RABBITMQ_TTL_MS = 2 ** 32 - 1;
const MAX_NOTIFICATION_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 30000;

@Injectable()
export class TripCompletedConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TripCompletedConsumer.name);
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private exchange = '';
  private deadLetterExchange = '';
  private failedRoutingKey = '';
  private retryQueue = '';
  private readonly retryQueues = new Map<string, string>();
  private failedQueue = '';
  private readonly maxRetries = MAX_NOTIFICATION_RETRIES;
  private readonly retryDelayMs = INITIAL_RETRY_DELAY_MS;

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly registerReceiptUseCase: RegisterReceiptUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    const queue = process.env.RABBITMQ_QUEUE || 'm8_notifications_queue';
    const exchange = process.env.RABBITMQ_EXCHANGE || 'urban_mobility_events';
    const exchangeType = process.env.RABBITMQ_EXCHANGE_TYPE || 'topic';
    this.exchange = exchange;
    this.deadLetterExchange =
      process.env.RABBITMQ_DLX_EXCHANGE || 'notifications.dlx';
    this.failedQueue =
      process.env.RABBITMQ_FAILED_QUEUE || 'notifications.failed';
    this.failedRoutingKey =
      process.env.RABBITMQ_FAILED_ROUTING_KEY || 'notifications.failed';
    const routingKey =
      process.env.RABBITMQ_TRIP_COMPLETED_ROUTING_KEY || 'trip.completed';
    const routingKeys = Array.from(
      new Set([
        routingKey,
        'trip.assigned',
        'driver.arrived',
        'trip.cancelled',
        'reservation.created',
        'reservation.confirmed',
        'reservation.reminder',
        'payment.captured',
      ]),
    );
    this.retryQueue = `${queue}.retry`;
    this.getRetryDelayMs(this.maxRetries);

    try {
      this.connection = await amqp.connect(url);
      this.connection.on('error', (error: Error) => {
        this.logger.error(`Error de conexión RabbitMQ: ${error.message}`);
      });

      this.channel = await this.connection.createConfirmChannel();
      await this.channel.assertExchange(exchange, exchangeType, {
        durable: true,
      });
      await this.channel.assertExchange(this.deadLetterExchange, 'direct', {
        durable: true,
      });
      await this.channel.assertQueue(queue, { durable: true });
      this.retryQueues.clear();
      for (const [index, key] of routingKeys.entries()) {
        const retryQueue =
          index === 0
            ? this.retryQueue
            : `${queue}.retry.${key.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        this.retryQueues.set(key, retryQueue);
        await this.channel.assertQueue(retryQueue, {
          durable: true,
          arguments: {
            'x-message-ttl': this.retryDelayMs,
            'x-dead-letter-exchange': exchange,
            'x-dead-letter-routing-key': key,
          },
        });
      }
      await this.channel.assertQueue(this.failedQueue, { durable: true });
      await this.channel.bindQueue(
        this.failedQueue,
        this.deadLetterExchange,
        this.failedRoutingKey,
      );
      for (const key of routingKeys) {
        await this.channel.bindQueue(queue, exchange, key);
      }
      await this.channel.prefetch(1);
      await this.channel.consume(
        queue,
        (message) => {
          if (message) {
            void this.handleMessage(message);
          }
        },
        { noAck: false },
      );

      this.logger.log(
        `Escuchando ${exchange} (${routingKeys.join(', ')}) en la cola durable ${queue}`,
      );
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `No se pudo iniciar el consumidor RabbitMQ: ${details}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.closeConnection();
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeConnection();
  }

  private async handleMessage(message: ConsumeMessage): Promise<void> {
    let event: unknown;
    try {
      event = JSON.parse(message.content.toString('utf8'));
    } catch (error) {
      await this.rejectMalformedMessage(message, 'el contenido no es JSON válido');
      return;
    }

    if (this.isCoordinatedEventoEntrada(event)) {
      await this.handleCoordinatedEvent(message, event);
      return;
    }

    if (
      this.isRecord(event) &&
      this.isMappedCanonicalEventType(event.eventType)
    ) {
      const mappedEvent = this.mapCanonicalEventToEventoEntrada(event);
      if (!mappedEvent) {
        await this.rejectMalformedMessage(
          message,
          'el payload no cumple el contrato del evento canónico para EventoEntrada',
        );
        return;
      }
      await this.handleCoordinatedEvent(
        message,
        mappedEvent,
        event.eventType === 'trip.completed',
      );
      return;
    }

    const notification = this.getCanonicalNotification(event);
    if (!notification) {
      await this.rejectMalformedMessage(
        message,
        'el payload no cumple un contrato canónico de viajes o reservas',
      );
      return;
    }

    try {
      const result = await this.notificationsService.send(
        {
          ...notification.dto,
          channel: NotificationChannelDto.EMAIL,
        },
        notification.eventId,
        this.getRetryCount(message) > 0,
        true,
      );

      if (
        result.success ||
        (result.status === 'FAILED' && !result.retryable)
      ) {
        if (result.duplicate && result.success) {
          this.logger.log(
            `Evento ${notification.eventId} ya procesado; se omite el envío duplicado`,
          );
        } else if (result.success) {
          this.logger.log(
            `Evento ${notification.eventId} procesado; notificación ${result.id} enviada`,
          );
        } else {
          this.logger.error(
            `Evento ${notification.eventId}: notificación no reintentable registrada como FAILED`,
          );
        }
        this.channel?.ack(message);
        return;
      }

      await this.retryOrFail(
        message,
        notification.eventId,
        result.status === 'PENDING'
          ? 'notificación en procesamiento por una entrega concurrente'
          : 'proveedor de notificaciones no disponible',
      );
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `No se pudo procesar el evento ${notification.eventId}: ${details}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.retryOrFail(message, notification.eventId, details);
    }
  }

  private mapCanonicalEventToEventoEntrada(
    value: unknown,
  ): EventoEntrada | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const event = value;
    if (!this.isRecord(event.data)) {
      return null;
    }
    const data = event.data;
    const eventId = this.getString(event.eventId);
    const occurredAt = this.getString(event.timestamp);
    if (
      !eventId ||
      !this.getString(event.version) ||
      !occurredAt ||
      !this.isMappedCanonicalEventType(event.eventType)
    ) {
      return null;
    }

    switch (event.eventType) {
      case 'trip.completed': {
        const tripId = this.getString(data.tripId);
        const passengerId = this.getString(data.passengerId);
        const passengerEmail = this.getString(data.passengerEmail);
        const origin = this.getString(data.origin);
        const destination = this.getString(data.destination);
        const currency = this.getString(data.currency);
        if (
          !tripId ||
          !passengerId ||
          !passengerEmail ||
          !isEmail(passengerEmail) ||
          !this.getString(data.driverId) ||
          !origin ||
          !destination ||
          !this.getString(data.completedAt) ||
          !currency ||
          !/^[A-Z]{3}$/.test(currency) ||
          typeof data.totalFare !== 'number' ||
          !Number.isFinite(data.totalFare) ||
          data.totalFare < 0
        ) {
          return null;
        }
        return {
          eventoId: eventId,
          tipo: 'VIAJE_FINALIZADO',
          origen: 'M6',
          ocurridoEn: occurredAt,
          viajeId: tripId,
          destinatarios: [
            {
              usuarioId: passengerId,
              rol: 'CLIENTE',
              email: passengerEmail,
              canalesPreferidos: ['EMAIL'],
            },
          ],
          detalle: {
            origen: origin,
            destino: destination,
            importe: { monto: data.totalFare, moneda: currency },
          },
        };
      }
      case 'reservation.created': {
        const reservationId = this.getString(data.reservationId);
        const passengerId = this.getString(data.passengerId);
        const passengerEmail = this.getString(data.passengerEmail);
        const scheduledPickupTime = this.getString(data.scheduledPickupTime);
        const origin = this.getString(data.origin);
        const destination = this.getString(data.destination);
        const currency = this.getString(data.currency);
        if (
          !reservationId ||
          !passengerId ||
          !passengerEmail ||
          !isEmail(passengerEmail) ||
          (data.scheduledPickupTime !== undefined && !scheduledPickupTime) ||
          (data.origin !== undefined && !origin) ||
          (data.destination !== undefined && !destination) ||
          (data.vehicleType !== undefined &&
            typeof data.vehicleType !== 'string') ||
          (data.estimatedFare !== undefined &&
            (typeof data.estimatedFare !== 'number' ||
              !Number.isFinite(data.estimatedFare) ||
              data.estimatedFare < 0)) ||
          (data.currency !== undefined &&
            (!currency || !/^[A-Z]{3}$/.test(currency)))
        ) {
          return null;
        }
        return {
          eventoId: eventId,
          tipo: 'RESERVA_CREADA',
          origen: 'M9',
          ocurridoEn: occurredAt,
          reservaId: reservationId,
          destinatarios: [
            {
              usuarioId: passengerId,
              rol: 'CLIENTE',
              email: passengerEmail,
              canalesPreferidos: ['EMAIL'],
            },
          ],
          detalle: {
            ...(origin ? { origen: origin } : {}),
            ...(destination ? { destino: destination } : {}),
            ...(scheduledPickupTime
              ? { fechaProgramada: scheduledPickupTime }
              : {}),
            ...(data.vehicleType === 'AUTO' || data.vehicleType === 'MOTO'
              ? { tipoVehiculo: data.vehicleType }
              : {}),
            ...(typeof data.estimatedFare === 'number'
              ? {
                  importe: {
                    monto: data.estimatedFare,
                    moneda: currency ?? 'ARS',
                  },
                }
              : {}),
          },
        };
      }
      case 'payment.captured': {
        const paymentId = this.getString(data.paymentId);
        const userId = this.getString(data.userId);
        const userEmail = this.getString(data.userEmail);
        const currency = this.getString(data.currency);
        const paymentMethod = this.getString(data.paymentMethod);
        if (
          !paymentId ||
          !userId ||
          !userEmail ||
          !isEmail(userEmail) ||
          !currency ||
          !/^[A-Z]{3}$/.test(currency) ||
          !paymentMethod ||
          !this.getString(data.capturedAt) ||
          typeof data.amount !== 'number' ||
          !Number.isFinite(data.amount) ||
          data.amount < 0 ||
          (data.tripId !== undefined && !this.getString(data.tripId)) ||
          (data.reservationId !== undefined &&
            !this.getString(data.reservationId))
        ) {
          return null;
        }
        return {
          eventoId: eventId,
          tipo: 'PAGO_CAPTURADO',
          origen: 'M7',
          ocurridoEn: occurredAt,
          ...(typeof data.tripId === 'string' ? { viajeId: data.tripId } : {}),
          ...(typeof data.reservationId === 'string'
            ? { reservaId: data.reservationId }
            : {}),
          pagoId: paymentId,
          destinatarios: [
            {
              usuarioId: userId,
              rol: 'CLIENTE',
              email: userEmail,
              canalesPreferidos: ['EMAIL'],
            },
          ],
          detalle: {
            motivo: `Método de pago: ${paymentMethod}`,
            importe: { monto: data.amount, moneda: currency },
          },
        };
      }
    }
  }

  private getCanonicalNotification(value: unknown): {
    eventId: string;
    dto: {
      recipient: string;
      subject: string;
      content: string;
      referenceId: string;
      referenceType: 'TRIP' | 'RESERVATION';
    };
  } | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const event = value;
    if (!this.isRecord(event.data)) {
      return null;
    }
    const data = event.data;
    const passengerEmail = this.getString(data.passengerEmail);
    if (
      typeof event.eventId !== 'string' ||
      typeof event.eventType !== 'string' ||
      typeof event.timestamp !== 'string' ||
      typeof event.version !== 'string' ||
      !passengerEmail ||
      !isEmail(passengerEmail)
    ) {
      return null;
    }

    const tripId = this.getString(data.tripId);
    const reservationId = this.getString(data.reservationId);
    let subject: string;
    let content: string;
    let referenceId: string;
    let referenceType: 'TRIP' | 'RESERVATION';

    switch (event.eventType) {
      case 'trip.assigned':
        if (
          !tripId ||
          !this.getString(data.driverId) ||
          !this.getString(data.driverName) ||
          !this.getString(data.vehicleModel) ||
          !this.getString(data.vehiclePlate) ||
          typeof data.estimatedArrivalMinutes !== 'number' ||
          !Number.isFinite(data.estimatedArrivalMinutes)
        ) {
          return null;
        }
        subject = `Conductor asignado al viaje: ${tripId}`;
        content = [
          `Hola. ${String(data.driverName)} fue asignado a tu viaje ${tripId}`,
          `en un vehículo ${String(data.vehicleModel)} (${String(data.vehiclePlate)}).`,
          `Llegará en aproximadamente ${data.estimatedArrivalMinutes} minutos.`,
        ].join(' ');
        referenceId = tripId;
        referenceType = 'TRIP';
        break;
      case 'driver.arrived': {
        const pickupLocation = this.getString(data.pickupLocation);
        if (
          !tripId ||
          !pickupLocation ||
          !this.getString(data.arrivedAt)
        ) {
          return null;
        }
        subject = `Tu conductor llegó: ${tripId}`;
        content = `Hola. Tu conductor llegó al punto de encuentro ${pickupLocation} para el viaje ${tripId}.`;
        referenceId = tripId;
        referenceType = 'TRIP';
        break;
      }
      case 'trip.cancelled':
        if (!tripId) {
          return null;
        }
        const cancelledBy = data.cancelledBy;
        if (
          cancelledBy !== 'PASSENGER' &&
          cancelledBy !== 'DRIVER' &&
          cancelledBy !== 'SYSTEM'
        ) {
          return null;
        }
        if (
          (data.reason !== undefined && typeof data.reason !== 'string') ||
          (data.cancellationFee !== undefined &&
            (typeof data.cancellationFee !== 'number' ||
              !Number.isFinite(data.cancellationFee)))
        ) {
          return null;
        }
        subject = `Viaje cancelado: ${tripId}`;
        content = [
          `Hola. El viaje ${tripId} fue cancelado por ${cancelledBy.toLowerCase()}.`,
          typeof data.reason === 'string' ? `Motivo: ${data.reason}.` : '',
          typeof data.cancellationFee === 'number'
            ? `Cargo de cancelación: ${data.cancellationFee}.`
            : '',
        ]
          .filter(Boolean)
          .join(' ');
        referenceId = tripId;
        referenceType = 'TRIP';
        break;
      case 'reservation.confirmed': {
        const scheduledPickupTime = this.getString(data.scheduledPickupTime);
        const origin = this.getString(data.origin);
        const destination = this.getString(data.destination);
        const vehicleType = this.getString(data.vehicleType);
        if (
          !reservationId ||
          !scheduledPickupTime ||
          !origin ||
          !destination ||
          !vehicleType ||
          typeof data.estimatedFare !== 'number' ||
          !Number.isFinite(data.estimatedFare)
        ) {
          return null;
        }
        subject = `Reserva confirmada: ${reservationId}`;
        content = [
          `Tu viaje programado para las ${scheduledPickupTime} desde ${origin}`,
          `hasta ${destination} fue confirmado.`,
          `Tipo de vehículo: ${vehicleType}.`,
          `Tarifa estimada: ${data.estimatedFare}.`,
        ].join(' ');
        referenceId = reservationId;
        referenceType = 'RESERVATION';
        break;
      }
      case 'reservation.reminder': {
        const scheduledPickupTime = this.getString(data.scheduledPickupTime);
        if (
          !reservationId ||
          !scheduledPickupTime ||
          typeof data.minutesUntilPickup !== 'number' ||
          !Number.isFinite(data.minutesUntilPickup)
        ) {
          return null;
        }
        subject = `Recordatorio de reserva: ${reservationId}`;
        content = `Te recordamos que el viaje de la reserva ${reservationId} está programado para las ${scheduledPickupTime}, dentro de ${data.minutesUntilPickup} minutos.`;
        referenceId = reservationId;
        referenceType = 'RESERVATION';
        break;
      }
      default:
        return null;
    }

    return {
      eventId: event.eventId,
      dto: {
        recipient: passengerEmail,
        subject,
        content,
        referenceId,
        referenceType,
      },
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private isMappedCanonicalEventType(
    value: unknown,
  ): value is 'trip.completed' | 'reservation.created' | 'payment.captured' {
    return (
      value === 'trip.completed' ||
      value === 'reservation.created' ||
      value === 'payment.captured'
    );
  }

  private getString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private isCoordinatedEventoEntrada(
    value: unknown,
  ): value is EventoEntrada {
    if (!this.isRecord(value)) {
      return false;
    }
    const ev = value;
    const destinatarios = ev.destinatarios;
    return (
      Boolean(this.getString(ev.eventoId)) &&
      this.isEventoTipo(ev.tipo) &&
      (ev.origen === 'M5' ||
        ev.origen === 'M6' ||
        ev.origen === 'M7' ||
        ev.origen === 'M9') &&
      Boolean(this.getString(ev.ocurridoEn)) &&
      (Boolean(this.getString(ev.viajeId)) ||
        Boolean(this.getString(ev.reservaId)) ||
        Boolean(this.getString(ev.pagoId))) &&
      Array.isArray(destinatarios) &&
      destinatarios.length > 0 &&
      destinatarios.every(
        (destinatario) =>
          this.isRecord(destinatario) &&
          Boolean(this.getString(destinatario.usuarioId)) &&
          (destinatario.rol === 'CLIENTE' ||
            destinatario.rol === 'CONDUCTOR') &&
          (destinatario.email === undefined ||
            typeof destinatario.email === 'string') &&
          (destinatario.telefono === undefined ||
            typeof destinatario.telefono === 'string') &&
          (destinatario.canalesPreferidos === undefined ||
            (Array.isArray(destinatario.canalesPreferidos) &&
              destinatario.canalesPreferidos.every(
                (channel) =>
                  channel === 'EMAIL' || channel === 'SMS' || channel === 'PUSH',
              ))),
      ) &&
      (ev.detalle === undefined || this.isValidEventoDetalle(ev.detalle))
    );
  }

  private isEventoTipo(value: unknown): value is EventoEntrada['tipo'] {
    return (
      typeof value === 'string' &&
      EVENTO_TIPOS.some((eventType) => eventType === value)
    );
  }

  private isValidEventoDetalle(value: unknown): boolean {
    if (!this.isRecord(value)) {
      return false;
    }
    return (
      ['origen', 'destino', 'fechaProgramada', 'zonaHoraria', 'motivo'].every(
        (key) => value[key] === undefined || typeof value[key] === 'string',
      ) &&
      (value.tipoVehiculo === undefined ||
        value.tipoVehiculo === 'AUTO' ||
        value.tipoVehiculo === 'MOTO') &&
      (value.importe === undefined ||
        (this.isRecord(value.importe) &&
          typeof value.importe.monto === 'number' &&
          Number.isFinite(value.importe.monto) &&
          value.importe.monto >= 0 &&
          typeof value.importe.moneda === 'string' &&
          /^[A-Z]{3}$/.test(value.importe.moneda)))
    );
  }

  private async handleCoordinatedEvent(
    message: ConsumeMessage,
    event: EventoEntrada,
    registerTripReceipt = false,
  ): Promise<void> {
    const dest = event.destinatarios[0];
    const recipient = dest.email || `${dest.usuarioId}@notificaciones.m8.local`;
    const referenceId = event.viajeId ?? event.reservaId ?? event.pagoId;
    const referenceType = event.viajeId
      ? 'TRIP'
      : event.reservaId
        ? 'RESERVATION'
        : 'PAYMENT';
    const subject =
      event.tipo === 'VIAJE_FINALIZADO'
        ? `Viaje finalizado: ${referenceId}`
        : event.tipo === 'RESERVA_CREADA'
          ? `Reserva creada: ${referenceId}`
          : event.tipo === 'PAGO_CAPTURADO'
            ? `Pago capturado: ${referenceId}`
            : `Notificación de ${event.tipo} (${event.origen})`;
    const contentParts = [
      `Hito ${event.tipo} informado por ${event.origen} para referencia ${referenceId}.`,
    ];
    if (event.detalle?.origen && event.detalle.destino) {
      contentParts.push(
        `Trayecto: ${event.detalle.origen} -> ${event.detalle.destino}.`,
      );
    }
    if (event.detalle?.fechaProgramada) {
      contentParts.push(`Fecha programada: ${event.detalle.fechaProgramada}.`);
    }
    if (event.detalle?.tipoVehiculo) {
      contentParts.push(`Tipo de vehículo: ${event.detalle.tipoVehiculo}.`);
    }
    if (event.detalle?.importe) {
      const { monto, moneda } = event.detalle.importe;
      contentParts.push(
        event.tipo === 'VIAJE_FINALIZADO'
          ? `Total abonado: ${moneda} ${monto}.`
          : `Importe: ${moneda} ${monto}.`,
      );
    }
    if (event.detalle?.motivo) {
      contentParts.push(`Detalle: ${event.detalle.motivo}.`);
    }

    try {
      if (registerTripReceipt) {
        const tripId = event.viajeId;
        const customer = event.destinatarios.find(
          (destinatario) => destinatario.rol === 'CLIENTE',
        );
        const amount = event.detalle?.importe;
        if (!tripId || !customer?.email || !amount) {
          throw new Error(
            'El evento trip.completed no tiene los datos necesarios para emitir el comprobante.',
          );
        }
        const receipt = await this.registerReceiptUseCase.execute({
          tripId,
          passengerId: customer.usuarioId,
          passengerEmail: customer.email,
          amount: amount.monto,
          currency: amount.moneda,
        });
        contentParts.push(`Comprobante emitido: ${receipt.receiptCode}.`);
        this.logger.log(
          `Comprobante ${receipt.receiptCode} registrado para el viaje ${tripId}`,
        );
      }

      const content = contentParts.join(' ');
      const result = await this.notificationsService.send(
        {
          channel: NotificationChannelDto.EMAIL,
          recipient,
          subject,
          content,
          referenceId,
          referenceType,
        },
        event.eventoId,
        this.getRetryCount(message) > 0,
        true,
      );

      if (result.success || (result.status === 'FAILED' && !result.retryable)) {
        this.channel?.ack(message);
        return;
      }

      await this.retryOrFail(
        message,
        event.eventoId,
        'proveedor de notificaciones no disponible',
      );
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `No se pudo completar el evento ${event.eventoId}: ${details}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.retryOrFail(message, event.eventoId, details);
    }
  }

  private async rejectMalformedMessage(
    message: ConsumeMessage,
    reason: string,
  ): Promise<void> {
    this.logger.error(`Evento RabbitMQ rechazado: ${reason}`);
    try {
      await this.publishToDeadLetterExchange(message, {
        'x-failure-reason': reason,
      });
      this.channel?.ack(message);
    } catch (error) {
      this.logger.error('No se pudo preservar el evento inválido en la cola de fallos.');
      this.channel?.nack(message, false, true);
    }
  }

  private async retryOrFail(
    message: ConsumeMessage,
    eventId: string,
    reason: string,
  ): Promise<void> {
    const retryCount = this.getRetryCount(message);
    const nextRetryCount = retryCount + 1;

    try {
      if (retryCount < this.maxRetries) {
        const baseRetryQueue =
          this.retryQueues.get(message.fields.routingKey) ?? this.retryQueue;
        const retryQueue =
          nextRetryCount === 1
            ? baseRetryQueue
            : `${baseRetryQueue}.attempt-${nextRetryCount}`;
        const retryDelayMs = this.getRetryDelayMs(nextRetryCount);
        if (nextRetryCount > 1) {
          await this.assertRetryQueue(
            retryQueue,
            message.fields.routingKey,
            retryDelayMs,
          );
        }
        await this.publishToQueue(retryQueue, message, {
          'x-notification-retry-count': nextRetryCount,
        });
        this.logger.warn(
          `Evento ${eventId} programado para reintento ${nextRetryCount}/${this.maxRetries} en ${retryDelayMs} ms en ${retryQueue}: ${reason}`,
        );
      } else {
        await this.publishToDeadLetterExchange(message, {
          'x-notification-retry-count': retryCount,
          'x-failure-reason': reason,
        });
        await this.notificationsService.markFailed(eventId, reason);
        this.logger.error(
          `Evento ${eventId} agotó ${this.maxRetries} reintentos; quedó en ${this.failedQueue}`,
        );
      }
      this.channel?.ack(message);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `No se pudo guardar el reintento del evento ${eventId}: ${details}`,
      );
      this.channel?.nack(message, false, true);
    }
  }

  private async assertRetryQueue(
    queue: string,
    routingKey: string,
    retryDelayMs: number,
  ): Promise<void> {
    if (!this.channel) {
      throw new Error('El canal RabbitMQ no está disponible.');
    }
    await this.channel.assertQueue(queue, {
      durable: true,
      arguments: {
        'x-message-ttl': retryDelayMs,
        'x-dead-letter-exchange': this.exchange,
        'x-dead-letter-routing-key': routingKey,
      },
    });
  }

  private async publishToQueue(
    queue: string,
    message: ConsumeMessage,
    additionalHeaders: Record<string, string | number>,
  ): Promise<void> {
    if (!this.channel) {
      throw new Error('El canal RabbitMQ no está disponible.');
    }
    this.channel.sendToQueue(queue, message.content, {
      persistent: true,
      contentType: message.properties.contentType,
      contentEncoding: message.properties.contentEncoding,
      correlationId: message.properties.correlationId,
      messageId: message.properties.messageId,
      headers: {
        ...message.properties.headers,
        ...additionalHeaders,
      },
    });
    await this.channel.waitForConfirms();
  }

  private async publishToDeadLetterExchange(
    message: ConsumeMessage,
    additionalHeaders: Record<string, string | number>,
  ): Promise<void> {
    if (!this.channel) {
      throw new Error('El canal RabbitMQ no está disponible.');
    }
    this.channel.publish(
      this.deadLetterExchange,
      this.failedRoutingKey,
      message.content,
      {
        persistent: true,
        contentType: message.properties.contentType,
        contentEncoding: message.properties.contentEncoding,
        correlationId: message.properties.correlationId,
        messageId: message.properties.messageId,
        headers: {
          ...message.properties.headers,
          ...additionalHeaders,
        },
      },
    );
    await this.channel.waitForConfirms();
  }

  private getRetryDelayMs(retryAttempt: number): number {
    const delayMs = this.retryDelayMs * 2 ** (retryAttempt - 1);
    if (!Number.isSafeInteger(delayMs) || delayMs > MAX_RABBITMQ_TTL_MS) {
      throw new Error(
        'La demora exponencial de reintento excede el TTL máximo permitido por RabbitMQ.',
      );
    }
    return delayMs;
  }

  private getRetryCount(message: ConsumeMessage): number {
    const value = message.properties.headers?.['x-notification-retry-count'];
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
      ? value
      : 0;
  }

  private async closeConnection(): Promise<void> {
    const channel = this.channel;
    const connection = this.connection;
    this.channel = null;
    this.connection = null;

    if (channel) {
      await channel.close();
    }
    if (connection) {
      await connection.close();
    }
  }
}
