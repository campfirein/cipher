# Redis Caching Support for Cipher Memory

## Overview

This document proposes adding Redis caching support to Cipher to accelerate memory recall operations and reduce database load. The feature implements a two-tier caching architecture using Redis as a hot tier cache in front of the existing vector database warm tier.

## Motivation

Current Cipher deployments experience memory recall latencies of 150-300ms (p95) due to vector similarity searches against PostgreSQL or other vector stores. For production AI applications with high query rates, this latency impacts user experience and increases infrastructure costs.

Redis caching provides:
- **Sub-60ms p95 recall latency** for cached items
- **70-80% database load reduction** through cache hits
- **Horizontal scalability** via Redis cluster support
- **Minimal code changes** using cache-aside pattern

## Architecture

### Two-Tier Caching Design

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ recall(query)
       ▼
┌──────────────────────┐
│  Cipher Memory       │
│  ┌────────────────┐  │
│  │ Cache Check    │  │ <60ms p95
│  │ (Redis)        │  │
│  └────────┬───────┘  │
│           │ miss     │
│           ▼          │
│  ┌────────────────┐  │
│  │ Vector Search  │  │ <300ms p95
│  │ (PostgreSQL)   │  │
│  └────────┬───────┘  │
│           │          │
│  ┌────────────────┐  │
│  │ Cache Populate │  │
│  │ (SETEX 1h TTL) │  │
│  └────────────────┘  │
└──────────────────────┘
```

### Cache-Aside Pattern

1. **Read Path**:
   - Check Redis for cached result using `GET recall:sha256(query)`
   - On hit: Return cached embedding and metadata (<60ms)
   - On miss: Query vector store, cache result with `SETEX`, return data

2. **Write Path**:
   - Store knowledge in vector database
   - Invalidate affected cache keys using `DEL recall:*`
   - Cache repopulates on next read

## Implementation Plan

### Phase 1: Core Caching Module

Create `src/core/cache/redis-cache.ts`:

```typescript
import Redis from 'ioredis';
import crypto from 'crypto';
import { logger } from '../logger/index.js';

export interface CacheConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  ttl: number;
  enabled: boolean;
}

export class RedisCache {
  private client: Redis;
  private ttl: number;
  private enabled: boolean;
  
  constructor(config: CacheConfig) {
    this.enabled = config.enabled;
    this.ttl = config.ttl;
    
    if (this.enabled) {
      this.client = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.db,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 50, 2000),
      });
      
      this.setupEventHandlers();
    }
  }
  
  async get<T>(query: string): Promise<T | null> {
    if (!this.enabled) return null;
    
    try {
      const key = this.hashQuery(query);
      const cached = await this.client.get(`recall:${key}`);
      return cached ? JSON.parse(cached) : null;
    } catch (err) {
      logger.error('Cache get error:', err);
      return null;
    }
  }
  
  async set(query: string, data: any): Promise<void> {
    if (!this.enabled) return;
    
    try {
      const key = this.hashQuery(query);
      await this.client.setex(`recall:${key}`, this.ttl, JSON.stringify(data));
    } catch (err) {
      logger.error('Cache set error:', err);
    }
  }
  
  async invalidate(pattern: string): Promise<void> {
    if (!this.enabled) return;
    
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (err) {
      logger.error('Cache invalidate error:', err);
    }
  }
  
  private hashQuery(query: string): string {
    return crypto.createHash('sha256').update(query).digest('hex');
  }
  
  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      logger.info('Redis cache connected');
    });
    
    this.client.on('error', (err) => {
      logger.error('Redis cache error:', err);
    });
  }
}
```

### Phase 2: Integration with Memory Search

Modify `src/core/brain/tools/definitions/memory/search_memory.ts`:

```typescript
import { RedisCache } from '../../../cache/redis-cache.js';

// Initialize cache (singleton pattern)
const cache = new RedisCache({
  host: env.REDIS_HOST || 'localhost',
  port: parseInt(env.REDIS_PORT || '6379'),
  password: env.REDIS_PASSWORD,
  db: 0,
  ttl: 3600,
  enabled: env.CACHE_ENABLED !== 'false',
});

// Modify execute function
async execute(args: any, context: InternalToolContext): Promise<MemorySearchResult> {
  const startTime = Date.now();
  
  // Check cache first
  const cached = await cache.get<MemorySearchResult>(args.query);
  if (cached) {
    logger.debug('Cache hit for memory search', { query: args.query.substring(0, 50) });
    return cached;
  }
  
  // Cache miss: perform vector search
  const result = await performVectorSearch(args, context);
  
  // Cache the result
  await cache.set(args.query, result);
  
  return result;
}
```

### Phase 3: Environment Configuration

Add to `.env.example`:

```bash
# Redis Caching Configuration
CACHE_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

Add to `src/core/env.ts`:

```typescript
export const env = {
  // ... existing config
  CACHE_ENABLED: process.env.CACHE_ENABLED !== 'false',
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: process.env.REDIS_PORT || '6379',
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
};
```

### Phase 4: Metrics and Monitoring

Add Prometheus metrics endpoint to `src/app/api/server.ts`:

```typescript
import { RedisCache } from '@core/cache/redis-cache.js';

// Add metrics route
this.app.get(`${this.apiPrefix}/metrics`, (req: Request, res: Response) => {
  const metrics = RedisCache.getMetrics();
  const hitRate = metrics.hits + metrics.misses > 0
    ? (metrics.hits / (metrics.hits + metrics.misses) * 100).toFixed(2)
    : 0;
    
  res.set('Content-Type', 'text/plain');
  res.send(`
# Cipher Memory Cache Metrics
cipher_cache_hits_total ${metrics.hits}
cipher_cache_misses_total ${metrics.misses}
cipher_cache_errors_total ${metrics.errors}
cipher_cache_connected ${metrics.connected ? 1 : 0}
cipher_cache_hit_rate ${hitRate}
  `);
});
```

## Performance Impact

### Benchmarks (Expected)

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| P95 recall latency (cached) | 200-300ms | <60ms | 70-80% |
| P95 recall latency (uncached) | 200-300ms | <300ms | Unchanged |
| Database queries | 100% | 20% | 80% reduction |
| Cache hit rate | N/A | >80% | N/A |

### Resource Requirements

- **Redis Memory**: ~1-2GB for 1M cached entries at 1KB average
- **Redis CPU**: Minimal (<100m) for cache operations
- **Network Bandwidth**: <10 Mbps for typical workloads

## Configuration Options

### Basic Configuration

```bash
# Enable caching
CACHE_ENABLED=true
REDIS_HOST=redis.example.com
REDIS_PORT=6379
REDIS_PASSWORD=your-secure-password
```

### Advanced Configuration

```typescript
// Custom cache configuration
const cache = new RedisCache({
  host: 'redis.example.com',
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  db: 0,
  ttl: 3600,  // 1 hour
  enabled: true,
});
```

## Deployment Considerations

### Redis Deployment Options

1. **Single Redis Instance**: Simplest deployment, suitable for development
2. **Redis Cluster**: Production-ready, handles high throughput and large datasets
3. **Managed Redis**: AWS ElastiCache, Azure Cache, GCP Memorystore

### High Availability

For production deployments, configure Redis with:
- Redis Sentinel for automatic failover
- Redis Cluster for horizontal scaling
- Persistent storage (RDB + AOF) for data durability

### Security

- Enable Redis authentication with strong passwords
- Use TLS for in-transit encryption
- Restrict network access via firewall rules
- Rotate credentials every 90 days

## Testing Strategy

### Unit Tests

```typescript
describe('RedisCache', () => {
  it('should cache and retrieve results', async () => {
    const cache = new RedisCache(testConfig);
    await cache.set('test-query', { data: 'test' });
    const result = await cache.get('test-query');
    expect(result).toEqual({ data: 'test' });
  });
  
  it('should invalidate cache keys by pattern', async () => {
    const cache = new RedisCache(testConfig);
    await cache.set('test-1', { data: '1' });
    await cache.set('test-2', { data: '2' });
    await cache.invalidate('recall:*');
    const result = await cache.get('test-1');
    expect(result).toBeNull();
  });
});
```

### Integration Tests

```typescript
describe('Memory Search with Caching', () => {
  it('should return cached results on second query', async () => {
    const query = 'test knowledge query';
    
    // First query: cache miss
    const result1 = await searchMemory({ query });
    expect(result1.metadata.usedCache).toBe(false);
    
    // Second query: cache hit
    const result2 = await searchMemory({ query });
    expect(result2.metadata.usedCache).toBe(true);
    expect(result2).toEqual(result1);
  });
});
```

## Migration Path

### Step 1: Deploy Redis

```bash
# Docker deployment
docker run -d --name redis \
  -p 6379:6379 \
  redis:7-alpine redis-server --requirepass your-password

# Kubernetes deployment
kubectl apply -f redis-deployment.yaml
```

### Step 2: Enable Caching

```bash
# Update environment variables
CACHE_ENABLED=true
REDIS_HOST=redis.example.com
REDIS_PASSWORD=your-password

# Restart Cipher server
npm run start
```

### Step 3: Monitor Performance

```bash
# Check cache metrics
curl http://localhost:3000/api/metrics

# Monitor cache hit rate
watch 'curl -s http://localhost:3000/api/metrics | grep cipher_cache_hit_rate'
```

### Step 4: Tune Configuration

```bash
# Adjust TTL for your workload
# Higher TTL: Better hit rate, more stale data
# Lower TTL: Fresher data, more cache misses

# Monitor and adjust
REDIS_TTL=1800  # 30 minutes for faster-changing data
REDIS_TTL=7200  # 2 hours for stable data
```

## Backward Compatibility

This feature is fully backward compatible:
- Caching is disabled by default (`CACHE_ENABLED=false`)
- Existing deployments work without Redis
- No database schema changes required
- Graceful degradation if Redis unavailable

## Future Enhancements

1. **Multi-tier Caching**: Add in-memory LRU cache for ultra-low latency
2. **Cache Warming**: Pre-populate cache with frequently accessed queries
3. **Intelligent TTL**: Dynamic TTL based on query patterns
4. **Cache Compression**: Reduce memory usage with compression
5. **Distributed Tracing**: Add OpenTelemetry instrumentation

## References

- [Redis Documentation](https://redis.io/documentation)
- [ioredis Client](https://github.com/redis/ioredis)
- [Cache-Aside Pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/cache-aside)
- [Redis Best Practices](https://redis.io/docs/manual/patterns/)

## Contributing

We welcome contributions! To implement this feature:

1. Fork the repository
2. Create feature branch: `git checkout -b feat/redis-caching-support`
3. Implement changes following this proposal
4. Add tests (unit + integration)
5. Update documentation
6. Submit pull request

## License

This feature proposal is licensed under Elastic-2.0, matching the Cipher project license.
