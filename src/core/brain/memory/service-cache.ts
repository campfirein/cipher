/**
 * Service Cache
 *
 * Global cache for expensive service instances to avoid redundant initializations
 */

import { logger } from '../../logger/index.js';

/**
 * Global service cache to prevent redundant initializations
 */
class ServiceCache {
	private static instance: ServiceCache | null = null;
	private cache = new Map<string, any>();
	private initPromises = new Map<string, Promise<any>>();

	static getInstance(): ServiceCache {
		if (!ServiceCache.instance) {
			ServiceCache.instance = new ServiceCache();
		}
		return ServiceCache.instance;
	}

	/**
	 * Get or create a cached service
	 */
	async getOrCreate<T>(
		key: string,
		factory: () => Promise<T>,
		options: { ttl?: number } = {}
	): Promise<T> {
		// Return cached instance if available
		if (this.cache.has(key)) {
			logger.debug(`ServiceCache: Cache hit for ${key}`);
			return this.cache.get(key);
		}

		// Return existing promise if creation is in progress
		if (this.initPromises.has(key)) {
			logger.debug(`ServiceCache: Waiting for in-progress creation of ${key}`);
			return await this.initPromises.get(key)!;
		}

		// Create new instance
		logger.debug(`ServiceCache: Cache miss, creating ${key}`, {
			cacheSize: this.cache.size,
			pendingPromises: this.initPromises.size,
			existingKeys: Array.from(this.cache.keys()).slice(0, 5), // Show first 5 keys for debugging
		});
		const promise = factory();
		this.initPromises.set(key, promise);

		try {
			const instance = await promise;
			this.cache.set(key, instance);
			this.initPromises.delete(key);

			// Set TTL if specified
			if (options.ttl) {
				setTimeout(() => {
					this.cache.delete(key);
					logger.debug(`ServiceCache: Expired ${key} after ${options.ttl}ms`);
				}, options.ttl);
			}

			logger.debug(`ServiceCache: Cached ${key}`);
			return instance;
		} catch (error) {
			this.initPromises.delete(key);
			throw error;
		}
	}

	/**
	 * Check if a service is cached
	 */
	has(key: string): boolean {
		return this.cache.has(key);
	}

	/**
	 * Clear the cache
	 */
	clear(): void {
		this.cache.clear();
		this.initPromises.clear();
		logger.debug('ServiceCache: Cache cleared');
	}

	/**
	 * Get cache statistics
	 */
	getStats() {
		return {
			cacheSize: this.cache.size,
			pendingPromises: this.initPromises.size,
			cachedKeys: Array.from(this.cache.keys()),
		};
	}
}

/**
 * Convenience function to get the global service cache
 */
export function getServiceCache(): ServiceCache {
	return ServiceCache.getInstance();
}

/**
 * Create a cache key for a service
 */
export function createServiceKey(type: string, config?: any): string {
	if (!config) {
		return type;
	}

	// Normalize config to ensure consistent cache keys
	const normalizedConfig = normalizeConfigForCache(config);

	// Create a simple hash of the normalized config
	const configStr = JSON.stringify(normalizedConfig);
	const hash = Array.from(configStr).reduce((hash, char) => {
		return (hash << 5) - hash + char.charCodeAt(0);
	}, 0);

	const cacheKey = `${type}:${Math.abs(hash)}`;

	return cacheKey;
}

/**
 * Normalize configuration for consistent cache key generation
 */
function normalizeConfigForCache(config: any): any {
	if (!config || typeof config !== 'object') {
		return config;
	}

	const normalized: any = {};

	for (const [key, value] of Object.entries(config)) {
		// Normalize undefined/null values to empty strings
		if (value === undefined || value === null) {
			normalized[key] = '';
		}
		// Normalize boolean values
		else if (typeof value === 'boolean') {
			normalized[key] = value;
		}
		// Normalize strings (trim and lowercase for case-insensitive keys)
		else if (typeof value === 'string') {
			normalized[key] = value.trim().toLowerCase();
		}
		// Keep numbers and other primitives as-is
		else if (typeof value !== 'object') {
			normalized[key] = value;
		}
		// Recursively normalize nested objects
		else {
			normalized[key] = normalizeConfigForCache(value);
		}
	}

	return normalized;
}
