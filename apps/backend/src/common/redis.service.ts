import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isReady = false;
  private readonly fallbackMemory = new Map<string, { value: string; expiresAt: number }>();

  async onModuleInit(): Promise<void> {
    const redisUrl = process.env.REDIS_URL?.trim();
    const host = process.env.REDIS_HOST || 'localhost';
    const port = Number(process.env.REDIS_PORT) || 6379;
    const password = process.env.REDIS_PASSWORD || undefined;

    const baseOptions: RedisOptions = {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    };

    try {
      const instance = redisUrl
        ? new Redis(redisUrl, baseOptions)
        : new Redis({
            ...baseOptions,
            host,
            port,
            password,
          });

      instance.on('error', (err) => {
        if (this.isReady) {
          this.logger.warn(`Evento de error en Redis (${err.message}). Conmutando a memoria local.`);
          this.isReady = false;
        }
      });

      instance.on('end', () => {
        this.isReady = false;
      });

      await instance.connect();
      this.client = instance;
      this.isReady = true;
      this.logger.log(
        redisUrl ? 'Conectado a Redis mediante REDIS_URL' : `Conectado a Redis en ${host}:${port}`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Redis no disponible (${err?.message ?? 'sin conexión'}). Usando caché en memoria local.`,
      );
      if (this.client) {
        this.client.disconnect();
      }
      this.client = null;
      this.isReady = false;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.fallbackMemory.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });

    if (this.client && this.isReady) {
      try {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } catch (e) {
        this.logger.warn('Fallo escribiendo en Redis, usando memoria de respaldo');
      }
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.client && this.isReady) {
      try {
        return await this.client.get(key);
      } catch (e) {
        this.logger.warn('Fallo leyendo de Redis, usando memoria de respaldo');
      }
    }
    return this.getFromFallback(key);
  }

  async getDel(key: string): Promise<string | null> {
    const memValue = this.getFromFallback(key);
    this.fallbackMemory.delete(key);

    if (this.client && this.isReady) {
      try {
        const val = await (this.client as any).getdel(key);
        return val ?? null;
      } catch (e) {
        this.logger.warn('Fallo en getDel de Redis, usando memoria de respaldo');
      }
    }
    return memValue;
  }

  async del(key: string): Promise<void> {
    this.fallbackMemory.delete(key);
    if (this.client && this.isReady) {
      try {
        await this.client.del(key);
      } catch (e) {
        // Ignorado si Redis no está disponible
      }
    }
  }

  private getFromFallback(key: string): string | null {
    const item = this.fallbackMemory.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.fallbackMemory.delete(key);
      return null;
    }
    return item.value;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
      this.client = null;
      this.isReady = false;
    }
  }
}
