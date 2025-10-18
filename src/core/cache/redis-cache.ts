import { Redis, type RedisOptions } from 'ioredis';
import crypto from 'crypto';
import { logger } from '../logger/index.js';

export interface CacheConfig {
  enabled: boolean;
  host: string;
  port: number;
  password?: string;
  db: number;
  ttl: number;
  keyPrefix: string;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  connected: boolean;
  errors: number;
}

export class RedisCache {
  private client: Redis | null = null;
  private config: CacheConfig;
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    connected: false,
    errors: 0,
  };

  constructor(config: CacheConfig) {
    this.config = config;

    if (!config.enabled) {
      logger.info('[RedisCache] Caching disabled via configuration');
      return;
    }

    this.initializeClient();
  }

  private initializeClient(): void {
    const options: RedisOptions = {
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      db: this.config.db,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        logger.warn(`[RedisCache] Retry attempt ${times}, delay ${delay}ms`);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    };

    try {
      this.client = new Redis(options);

      this.client.on('connect', () => {
        logger.info('[RedisCache] Connected to Redis server');
        this.metrics.connected = true;
      });

      this.client.on('ready', () => {
        logger.info('[RedisCache] Redis client ready');
      });

      this.client.on('error', (err: Error) => {
        logger.error('[RedisCache] Redis client error:', err.message);
        this.metrics.connected = false;
        this.metrics.errors++;
      });

      this.client.on('close', () => {
        logger.warn('[RedisCache] Redis connection closed');
        this.metrics.connected = false;
      });

      this.client.on('reconnecting', () => {
        logger.info('[RedisCache] Reconnecting to Redis server');
      });

      this.client.connect().catch((err: Error) => {
        logger.error('[RedisCache] Failed to connect to Redis:', err.message);
        this.metrics.connected = false;
      });
    } catch (err) {
      logger.error('[RedisCache] Failed to initialize Redis client:', err);
      this.client = null;
      this.metrics.connected = false;
    }
  }

  private hashQuery(query: string): string {
    const hash = crypto.createHash('sha256').update(query).digest('hex');
    return `${this.config.keyPrefix}:${hash}`;
  }

  async get<T>(query: string): Promise<T | null> {
    if (!this.config.enabled || !this.client || !this.metrics.connected) {
      return null;
    }

    try {
      const key = this.hashQuery(query);
      const value = await this.client.get(key);

      if (value) {
        this.metrics.hits++;
        logger.debug(`[RedisCache] Cache hit for key: ${key}`);
        return JSON.parse(value) as T;
      } else {
        this.metrics.misses++;
        logger.debug(`[RedisCache] Cache miss for key: ${key}`);
        return null;
      }
    } catch (err) {
      logger.error('[RedisCache] Error retrieving from cache:', err);
      this.metrics.errors++;
      return null;
    }
  }

  async set(query: string, data: any): Promise<void> {
    if (!this.config.enabled || !this.client || !this.metrics.connected) {
      return;
    }

    try {
      const key = this.hashQuery(query);
      const value = JSON.stringify(data);
      await this.client.setex(key, this.config.ttl, value);
      logger.debug(`[RedisCache] Cached result for key: ${key}, TTL: ${this.config.ttl}s`);
    } catch (err) {
      logger.error('[RedisCache] Error setting cache:', err);
      this.metrics.errors++;
    }
  }

  async invalidate(pattern: string): Promise<void> {
    if (!this.config.enabled || !this.client || !this.metrics.connected) {
      return;
    }

    try {
      const fullPattern = `${this.config.keyPrefix}:${pattern}`;
      const keys = await this.client.keys(fullPattern);

      if (keys.length > 0) {
        await this.client.del(...keys);
        logger.info(`[RedisCache] Invalidated ${keys.length} cache keys matching pattern: ${fullPattern}`);
      } else {
        logger.debug(`[RedisCache] No keys found matching pattern: ${fullPattern}`);
      }
    } catch (err) {
      logger.error('[RedisCache] Error invalidating cache:', err);
      this.metrics.errors++;
    }
  }

  getMetrics(): CacheMetrics {
    return {
      ...this.metrics,
      hitRate: this.metrics.hits + this.metrics.misses > 0
        ? this.metrics.hits / (this.metrics.hits + this.metrics.misses)
        : 0,
    } as CacheMetrics & { hitRate: number };
  }

  isReady(): boolean {
    return this.config.enabled && this.metrics.connected;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      logger.info('[RedisCache] Closing Redis connection');
      await this.client.quit();
      this.client = null;
      this.metrics.connected = false;
    }
  }

  async flushAll(): Promise<void> {
    if (!this.config.enabled || !this.client || !this.metrics.connected) {
      return;
    }

    try {
      await this.client.flushdb();
      logger.warn('[RedisCache] Flushed all cache entries');
    } catch (err) {
      logger.error('[RedisCache] Error flushing cache:', err);
      this.metrics.errors++;
    }
  }
}

let cacheInstance: RedisCache | null = null;

export function initializeCache(config: CacheConfig): RedisCache {
  if (!cacheInstance) {
    cacheInstance = new RedisCache(config);
  }
  return cacheInstance;
}

export function getCache(): RedisCache | null {
  return cacheInstance;
}
