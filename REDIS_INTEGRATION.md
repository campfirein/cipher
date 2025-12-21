# Redis Caching Integration Guide

This guide provides step-by-step instructions for integrating Redis caching support into Cipher.

## Overview

The Redis caching implementation is complete and ready for integration. This guide covers the remaining integration points in the existing codebase.

## Files Added

- `src/core/cache/redis-cache.ts` - Core Redis caching module
- `src/core/cache/index.ts` - Cache module exports
- `.env.example` - Redis configuration examples
- `docs/redis-caching.md` - Complete feature documentation

## Integration Steps

### 1. Environment Configuration (src/core/env.ts)

Add the following to the `envSchema` object in `src/core/env.ts`:

```typescript
// Add to envSchema z.object({ ... }):
CACHE_ENABLED: z.boolean().default(false),
REDIS_HOST: z.string().default('localhost'),
REDIS_PORT: z.number().default(6379),
REDIS_PASSWORD: z.string().optional(),
REDIS_DB: z.number().default(0),
REDIS_TTL: z.number().default(3600),
REDIS_KEY_PREFIX: z.string().default('recall'),
```

Add the following cases to the Proxy handler in `src/core/env.ts`:

```typescript
// Add to Proxy get() handler:
case 'CACHE_ENABLED':
  return process.env.CACHE_ENABLED === 'true';
case 'REDIS_HOST':
  return process.env.REDIS_HOST || 'localhost';
case 'REDIS_PORT':
  return process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379;
case 'REDIS_PASSWORD':
  return process.env.REDIS_PASSWORD;
case 'REDIS_DB':
  return process.env.REDIS_DB ? parseInt(process.env.REDIS_DB, 10) : 0;
case 'REDIS_TTL':
  return process.env.REDIS_TTL ? parseInt(process.env.REDIS_TTL, 10) : 3600;
case 'REDIS_KEY_PREFIX':
  return process.env.REDIS_KEY_PREFIX || 'recall';
```

### 2. Application Initialization

Add cache initialization to your application startup (e.g., `src/app/api/server.ts` or main entry point):

```typescript
import { initializeCache } from '../core/cache';
import { env } from '../core/env';

// Initialize cache on startup
const cache = initializeCache({
  enabled: env.CACHE_ENABLED,
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  db: env.REDIS_DB,
  ttl: env.REDIS_TTL,
  keyPrefix: env.REDIS_KEY_PREFIX,
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await cache?.disconnect();
  process.exit(0);
});
```

### 3. Memory Search Integration

Modify your memory search operations to use caching. Example integration for `src/core/brain/tools/definitions/memory/search_memory.ts`:

```typescript
import { getCache } from '../../../../cache';

async function searchMemory(params) {
  const cache = getCache();
  
  // Generate cache key from search parameters
  const cacheKey = JSON.stringify(params);
  
  // Check cache first
  if (cache && cache.isReady()) {
    const cachedResult = await cache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }
  }
  
  // Cache miss - perform vector search
  const result = await performVectorSearch(params);
  
  // Populate cache
  if (cache && cache.isReady() && result) {
    await cache.set(cacheKey, result);
  }
  
  return result;
}

// Invalidate cache on memory writes
async function addMemory(params) {
  const result = await addToVectorStore(params);
  
  const cache = getCache();
  if (cache && cache.isReady()) {
    await cache.invalidate('*'); // Invalidate all cached queries
  }
  
  return result;
}
```

### 4. Metrics Endpoint (Optional)

Add Prometheus metrics endpoint to `src/app/api/server.ts`:

```typescript
import { getCache } from '../core/cache';

app.get('/api/metrics', (req, res) => {
  const cache = getCache();
  
  if (!cache) {
    return res.status(503).send('# Cache not initialized\n');
  }
  
  const metrics = cache.getMetrics();
  const hitRate = (metrics.hits + metrics.misses > 0)
    ? (metrics.hits / (metrics.hits + metrics.misses)).toFixed(4)
    : '0.0000';
  
  const prometheusMetrics = `# HELP cipher_cache_hits_total Total number of cache hits
# TYPE cipher_cache_hits_total counter
cipher_cache_hits_total ${metrics.hits}

# HELP cipher_cache_misses_total Total number of cache misses
# TYPE cipher_cache_misses_total counter
cipher_cache_misses_total ${metrics.misses}

# HELP cipher_cache_errors_total Total number of cache errors
# TYPE cipher_cache_errors_total counter
cipher_cache_errors_total ${metrics.errors}

# HELP cipher_cache_connected Cache connection status
# TYPE cipher_cache_connected gauge
cipher_cache_connected ${metrics.connected ? 1 : 0}

# HELP cipher_cache_hit_rate Cache hit rate
# TYPE cipher_cache_hit_rate gauge
cipher_cache_hit_rate ${hitRate}
`;
  
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(prometheusMetrics);
});
```

## Testing

### Unit Tests

Unit tests are provided in the PR and can be added to your test suite. Place them in `tests/unit/cache/redis-cache.test.ts`.

Run unit tests:
```bash
npm run test:unit
```

### Integration Tests

Integration tests require a running Redis instance:

```bash
# Start Redis for testing
docker run -d --name redis-test -p 6379:6379 redis:7-alpine

# Run integration tests
REDIS_HOST=localhost REDIS_PORT=6379 npm run test:integration

# Cleanup
docker stop redis-test && docker rm redis-test
```

## Deployment

### Local Development

```bash
# Start Redis
docker run -d --name cipher-redis -p 6379:6379 redis:7-alpine

# Configure Cipher
export CACHE_ENABLED=true
export REDIS_HOST=localhost
export REDIS_PORT=6379

# Start Cipher
npm start
```

### Kubernetes with Dragonfly

```yaml
env:
  - name: CACHE_ENABLED
    value: "true"
  - name: REDIS_HOST
    value: "dragonfly.dbms.svc.cluster.local"
  - name: REDIS_PORT
    value: "6379"
  - name: REDIS_PASSWORD
    valueFrom:
      secretKeyRef:
        name: redis-secret
        key: password
```

### Managed Redis Services

Refer to `.env.example` for configuration examples for AWS ElastiCache, Azure Cache for Redis, and GCP Memorystore.

## Monitoring

Access metrics at `http://your-cipher-host:port/api/metrics` for Prometheus scraping.

Key metrics to monitor:
- `cipher_cache_hit_rate` - Target: >0.8 (80%)
- `cipher_cache_connected` - Target: 1 (connected)
- `cipher_cache_hits_total` - Monitor growth
- `cipher_cache_misses_total` - Monitor growth

## Rollback

If issues occur, disable caching:

```bash
export CACHE_ENABLED=false
```

The application will continue working with the vector database only (graceful degradation).

## Performance Validation

Expected performance improvements:
- P95 recall latency: 200-300ms → <60ms (cached)
- Database query load: -70-80%
- Cache hit rate: >80%

Monitor these metrics after deployment to validate performance gains.

## Support

For issues or questions, refer to:
- `docs/redis-caching.md` - Complete feature documentation
- GitHub issues for bug reports
- Pull request discussion for implementation questions
