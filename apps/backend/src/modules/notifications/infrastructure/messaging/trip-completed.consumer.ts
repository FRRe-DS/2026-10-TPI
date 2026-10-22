import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { TripCompletedEvent } from '@g10-m8/contracts';
import { isEmail } from 'class-validator';
import {
  ChannelModel,
  ConfirmChannel,
  ConsumeMessage,
} from 'amqplib';
import * as amqp from 'amqplib';
import { NotificationsService } from '../../application/notifications.service';
import { NotificationChannelDto } from '../../application/dto/send-notification.dto';

@Injectable()
export class TripCompletedConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TripCompletedConsumer.name);
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private retryQueue = '';
  private failedQueue = '';
  private maxRetries = 3;
  private retryDelayMs = 30000;

  constructor(private readonly notificationsService: NotificationsService) {}

  async onModuleInit(): Promise<void> {
    const url = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    const queue = process.env.RABBITMQ_QUEUE || 'm8_notifications_queue';
    const exchange = process.env.RABBITMQ_EXCHANGE || 'urban_mobility_events';
    const exchangeType = process.env.RABBITMQ_EXCHANGE_TYPE || 'topic';
    const routingKey =
      process.env.RABBITMQ_TRIP_COMPLETED_ROUTING_KEY || 'trip.completed';
    this.retryQueue = `${queue}.retry`;
    this.failedQueue = `${queue}.failed`;
    this.maxRetries = this.readPositiveInteger(
      process.env.RABBITMQ_NOTIFICATION_MAX_RETRIES,
      3,
      'RABBITMQ_NOTIFICATION_MAX_RETRIES',
    );
    this.retryDelayMs = this.readPositiveInteger(
      process.env.RABBITMQ_NOTIFICATION_RETRY_DELAY_MS,
      30000,
      'RABBITMQ_NOTIFICATION_RETRY_DELAY_MS',
    );

    try {
      this.connection = await amqp.connect(url);
      this.connection.on('error', (error: Error) => {
        this.logger.error(`Error de conexión RabbitMQ: ${error.message}`);
      });

      this.channel = await this.connection.createConfirmChannel();
      await this.channel.assertExchange(exchange, exchangeType, {
        durable: true,
      });
      await this.channel.assertQueue(queue, { durable: true });
      await this.channel.assertQueue(this.retryQueue, {
        durable: true,
        arguments: {
          'x-message-ttl': this.retryDelayMs,
          'x-dead-letter-exchange': exchange,
          'x-dead-letter-routing-key': routingKey,
        },
      });
      await this.channel.assertQueue(this.failedQueue, { durable: true });
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
      await this.rejectMalformedMessage(message, 'el contenido no es JSON válido');
      return;
    }

    if (!this.isTripCompletedEvent(event)) {
      await this.rejectMalformedMessage(
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
      }, event.eventId, this.getRetryCount(message) > 0);

      if (
        result.success ||
        (result.status === 'FAILED' && !result.retryable)
      ) {
        if (result.duplicate && result.success) {
          this.logger.log(
            `Evento ${event.eventId} ya procesado; se omite el envío duplicado`,
          );
        } else if (result.success) {
        this.logger.log(
          `Evento ${event.eventId} procesado; notificación ${result.id} enviada`,
        );
        } else {
          this.logger.error(
            `Evento ${event.eventId}: notificación no reintentable registrada como FAILED`,
          );
        }
        this.channel?.ack(message);
        return;
      }

      await this.retryOrFail(
        message,
        event.eventId,
        result.status === 'PENDING'
          ? 'notificación en procesamiento por una entrega concurrente'
          : 'proveedor de notificaciones no disponible',
      );
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `No se pudo procesar el evento ${event.eventId}: ${details}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.retryOrFail(message, event.eventId, details);
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

  private async rejectMalformedMessage(
    message: ConsumeMessage,
    reason: string,
  ): Promise<void> {
    this.logger.error(`Evento RabbitMQ rechazado: ${reason}`);
    try {
      await this.publishToQueue(this.failedQueue, message, {
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
        await this.publishToQueue(this.retryQueue, message, {
          'x-notification-retry-count': nextRetryCount,
        });
        this.logger.warn(
          `Evento ${eventId} programado para reintento ${nextRetryCount}/${this.maxRetries} en ${this.retryDelayMs} ms: ${reason}`,
        );
      } else {
        await this.publishToQueue(this.failedQueue, message, {
          'x-notification-retry-count': retryCount,
          'x-failure-reason': reason,
        });
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

  private getRetryCount(message: ConsumeMessage): number {
    const value = message.properties.headers?.['x-notification-retry-count'];
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
      ? value
      : 0;
  }

  private readPositiveInteger(
    value: string | undefined,
    defaultValue: number,
    name: string,
  ): number {
    if (value === undefined) {
      return defaultValue;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`${name} debe ser un entero mayor a cero.`);
    }
    return parsed;
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
