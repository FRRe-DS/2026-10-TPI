import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { TripCompletedEvent } from '@g10-m8/contracts';
import { isEmail } from 'class-validator';
import {
  Channel,
  ChannelModel,
  ConsumeMessage,
} from 'amqplib';
import * as amqp from 'amqplib';
import { NotificationsService } from '../../application/notifications.service';
import { NotificationChannelDto } from '../../application/dto/send-notification.dto';

@Injectable()
export class TripCompletedConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TripCompletedConsumer.name);
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;

  constructor(private readonly notificationsService: NotificationsService) {}

  async onModuleInit(): Promise<void> {
    const url = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    const queue = process.env.RABBITMQ_QUEUE || 'm8_notifications_queue';
    const exchange = process.env.RABBITMQ_EXCHANGE || 'urban_mobility_events';
    const exchangeType = process.env.RABBITMQ_EXCHANGE_TYPE || 'topic';
    const routingKey =
      process.env.RABBITMQ_TRIP_COMPLETED_ROUTING_KEY || 'trip.completed';

    try {
      this.connection = await amqp.connect(url);
      this.connection.on('error', (error: Error) => {
        this.logger.error(`Error de conexión RabbitMQ: ${error.message}`);
      });

      this.channel = await this.connection.createChannel();
      await this.channel.assertExchange(exchange, exchangeType, {
        durable: true,
      });
      await this.channel.assertQueue(queue, { durable: true });
      await this.channel.bindQueue(queue, exchange, routingKey);
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
        `Escuchando ${exchange} (${routingKey}) en la cola durable ${queue}`,
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
      this.rejectMalformedMessage(message, 'el contenido no es JSON válido');
      return;
    }

    if (!this.isTripCompletedEvent(event)) {
      this.rejectMalformedMessage(
        message,
        'el payload no cumple el contrato trip.completed',
      );
      return;
    }

    const { data } = event;
    const driverName = data.driverName || 'tu conductor';
    const amount = new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: data.currency,
    }).format(data.totalFare);
    const content = [
      `Hola. Tu viaje ${data.tripId} con ${driverName} ha finalizado.`,
      `Origen: ${data.origin}.`,
      `Destino: ${data.destination}.`,
      `Total abonado: ${amount}.`,
    ].join(' ');

    try {
      const result = await this.notificationsService.send({
        channel: NotificationChannelDto.EMAIL,
        recipient: data.passengerEmail,
        subject: `Viaje finalizado: ${data.tripId}`,
        content,
        referenceId: data.tripId,
        referenceType: 'TRIP',
      });

      if (result.success) {
        this.logger.log(
          `Evento ${event.eventId} procesado; notificación ${result.id} enviada`,
        );
      } else {
        this.logger.warn(
          `Evento ${event.eventId} procesado; intento de notificación registrado como FAILED`,
        );
      }
      this.channel?.ack(message);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `No se pudo procesar el evento ${event.eventId}; se reencolará: ${details}`,
        error instanceof Error ? error.stack : undefined,
      );
      this.channel?.nack(message, false, true);
    }
  }

  private isTripCompletedEvent(value: unknown): value is TripCompletedEvent {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const event = value as Record<string, unknown>;
    const data = event.data;
    if (typeof data !== 'object' || data === null) {
      return false;
    }

    const payload = data as Record<string, unknown>;
    return (
      event.eventType === 'trip.completed' &&
      typeof event.eventId === 'string' &&
      typeof event.timestamp === 'string' &&
      typeof event.version === 'string' &&
      typeof payload.tripId === 'string' &&
      typeof payload.passengerEmail === 'string' &&
      isEmail(payload.passengerEmail) &&
      typeof payload.driverId === 'string' &&
      typeof payload.totalFare === 'number' &&
      Number.isFinite(payload.totalFare) &&
      typeof payload.currency === 'string' &&
      typeof payload.origin === 'string' &&
      typeof payload.destination === 'string' &&
      typeof payload.completedAt === 'string' &&
      (payload.driverName === undefined ||
        typeof payload.driverName === 'string')
    );
  }

  private rejectMalformedMessage(
    message: ConsumeMessage,
    reason: string,
  ): void {
    this.logger.error(`Evento RabbitMQ rechazado: ${reason}`);
    this.channel?.nack(message, false, false);
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
