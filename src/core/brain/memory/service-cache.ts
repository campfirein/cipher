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
		logger.debug(`ServiceCache: Cache miss, creating ${key}`);
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

	// Create a simple hash of the config
	const configStr = JSON.stringify(config);
	const hash = Array.from(configStr).reduce((hash, char) => {
		return (hash << 5) - hash + char.charCodeAt(0);
	}, 0);

	return `${type}:${Math.abs(hash)}`;
}
