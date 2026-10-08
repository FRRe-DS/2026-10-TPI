import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private readonly fallbackMemory = new Map<string, { value: string; expiresAt: number }>();

  onModuleInit() {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = Number(process.env.REDIS_PORT) || 6379;
    const password = process.env.REDIS_PASSWORD || undefined;

    try {
      this.client = new Redis({
        host,
        port,
        password,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      });

      this.client
        .connect()
        .then(() => {
          this.logger.log(`Conectado a Redis en ${host}:${port}`);
        })
        .catch((err) => {
          this.logger.warn(`Redis no disponible (${err.message}). Usando caché en memoria local.`);
          this.client = null;
        });
    } catch (e) {
      this.logger.warn(`Error inicializando Redis. Usando memoria local.`);
      this.client = null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.client) {
      try {
        await this.client.set(key, value, 'EX', ttlSeconds);
        return;
      } catch (e) {
        this.logger.warn(`Fallo escribiendo en Redis, usando memoria de respaldo`);
      }
    }
    this.fallbackMemory.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async get(key: string): Promise<string | null> {
    if (this.client) {
      try {
        return await this.client.get(key);
      } catch (e) {
        this.logger.warn(`Fallo leyendo de Redis, usando memoria de respaldo`);
      }
    }
    const item = this.fallbackMemory.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.fallbackMemory.delete(key);
      return null;
    }
    return item.value;
  }

  async del(key: string): Promise<void> {
    if (this.client) {
      try {
        await this.client.del(key);
      } catch (e) { }
    }
    this.fallbackMemory.delete(key);
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }
}
