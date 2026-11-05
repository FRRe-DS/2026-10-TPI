import { Injectable } from '@nestjs/common';
import {
  NotificationMessage,
  NotificationSenderPort,
} from '../../modules/notifications/domain/ports/notification-sender.port';

/**
 * Doble de prueba del puerto de correo: registra los mensajes en memoria.
 * Reemplaza al adaptador Nodemailer/SMTP => la integración SMTP/Mailpit queda FUERA
 * del alcance de esta suite.
 */
@Injectable()
export class RecordingNotificationSender extends NotificationSenderPort {
  readonly sent: NotificationMessage[] = [];

  async send(notification: NotificationMessage): Promise<void> {
    this.sent.push(notification);
  }
}

/**
 * Doble en memoria de RedisService (mismos métodos públicos que usa la aplicación).
 * Reemplaza a Redis => la integración con Redis (TTL real de QR) queda FUERA del alcance.
 */
export class InMemoryRedisDouble {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item || Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async getDel(key: string): Promise<string | null> {
    const value = await this.get(key);
    this.store.delete(key);
    return value;
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

/**
 * Doble del consumidor RabbitMQ (TripCompletedConsumer): sin `onModuleInit`, por lo que
 * no abre conexión AMQP. La integración con RabbitMQ queda FUERA del alcance.
 */
export class NoopTripCompletedConsumer {}
