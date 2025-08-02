import { ITokenizer, TokenizerConfig } from './types.js';
import { logger } from '../../../logger/index.js';
import crypto from 'crypto';

/**
 * Thread-safe singleton cache for tokenizer instances
 * Prevents redundant tokenizer creation by caching instances based on configuration
 */
export class TokenizerCache {
	private static instance: TokenizerCache | null = null;
	private cache: Map<string, ITokenizer> = new Map();
	private readonly maxCacheSize = 50; // Prevent memory bloat
	private readonly cacheHits = new Map<string, number>();
	private readonly cacheAccess = new Map<string, number>(); // Track access times for LRU

	private constructor() {
		// Private constructor for singleton pattern
	}

	/**
	 * Get the singleton instance of TokenizerCache
	 */
	static getInstance(): TokenizerCache {
		if (!TokenizerCache.instance) {
			TokenizerCache.instance = new TokenizerCache();
		}
		return TokenizerCache.instance;
	}

	/**
	 * Generate a unique cache key based on tokenizer configuration
	 */
	private generateCacheKey(config: TokenizerConfig): string {
		// Create a deterministic hash of the configuration
		const configString = JSON.stringify({
			provider: config.provider,
			model: config.model || 'default',
			fallbackToApproximation: config.fallbackToApproximation,
			hybridTracking: config.hybridTracking,
		});

		// Use a short hash to keep keys manageable
		return crypto.createHash('md5').update(configString).digest('hex').substring(0, 16);
	}

	/**
	 * Get a tokenizer from cache or create new one
	 */
	get(config: TokenizerConfig, factory: (config: TokenizerConfig) => ITokenizer): ITokenizer {
		const cacheKey = this.generateCacheKey(config);

		// Check if tokenizer exists in cache
		if (this.cache.has(cacheKey)) {
			// Update access tracking
			this.cacheHits.set(cacheKey, (this.cacheHits.get(cacheKey) || 0) + 1);
			this.cacheAccess.set(cacheKey, Date.now());

			const tokenizer = this.cache.get(cacheKey)!;
			logger.debug('TokenizerCache: Cache hit', {
				cacheKey,
				provider: config.provider,
				model: config.model,
				totalHits: this.cacheHits.get(cacheKey),
				cacheSize: this.cache.size,
			});

			return tokenizer;
		}

		// Create new tokenizer if not in cache
		logger.debug('TokenizerCache: Cache miss, creating new tokenizer', {
			cacheKey,
			provider: config.provider,
			model: config.model,
			cacheSize: this.cache.size,
		});

		// Manage cache size with LRU eviction BEFORE creating new tokenizer
		if (this.cache.size >= this.maxCacheSize) {
			this.evictLeastRecentlyUsed();
		}

		const tokenizer = factory(config);

		// Store in cache
		this.cache.set(cacheKey, tokenizer);
		this.cacheHits.set(cacheKey, 1);
		this.cacheAccess.set(cacheKey, Date.now());

		logger.debug('TokenizerCache: Tokenizer cached', {
			cacheKey,
			provider: config.provider,
			model: config.model,
			cacheSize: this.cache.size,
		});

		return tokenizer;
	}

	/**
	 * Evict the least recently used tokenizer from cache
	 */
	private evictLeastRecentlyUsed(): void {
		let oldestKey: string | null = null;
		let oldestTime = Date.now();

		for (const [key, accessTime] of this.cacheAccess) {
			if (accessTime < oldestTime) {
				oldestTime = accessTime;
				oldestKey = key;
			}
		}

		if (oldestKey) {
			logger.debug('TokenizerCache: Evicting LRU tokenizer', {
				evictedKey: oldestKey,
				cacheSize: this.cache.size,
			});

			this.cache.delete(oldestKey);
			this.cacheHits.delete(oldestKey);
			this.cacheAccess.delete(oldestKey);
		}
	}

	/**
	 * Clear specific tokenizer from cache
	 */
	invalidate(config: TokenizerConfig): boolean {
		const cacheKey = this.generateCacheKey(config);
		const removed = this.cache.delete(cacheKey);

		if (removed) {
			this.cacheHits.delete(cacheKey);
			this.cacheAccess.delete(cacheKey);

			logger.debug('TokenizerCache: Tokenizer invalidated', {
				cacheKey,
				provider: config.provider,
				model: config.model,
			});
		}

		return removed;
	}

	/**
	 * Clear all cached tokenizers
	 */
	clear(): void {
		const size = this.cache.size;
		this.cache.clear();
		this.cacheHits.clear();
		this.cacheAccess.clear();

		logger.debug('TokenizerCache: All tokenizers cleared', {
			previousSize: size,
		});
	}

	/**
	 * Get cache statistics for monitoring
	 */
	getStats(): {
		cacheSize: number;
		maxCacheSize: number;
		totalHits: number;
		hitRate: number;
		entries: Array<{
			key: string;
			hits: number;
			lastAccess: number;
		}>;
	} {
		const totalHits = Array.from(this.cacheHits.values()).reduce((sum, hits) => sum + hits, 0);
		const totalRequests = totalHits + (this.cache.size > 0 ? this.cache.size : 1); // Avoid division by zero

		const entries = Array.from(this.cache.keys()).map(key => ({
			key,
			hits: this.cacheHits.get(key) || 0,
			lastAccess: this.cacheAccess.get(key) || 0,
		}));

		return {
			cacheSize: this.cache.size,
			maxCacheSize: this.maxCacheSize,
			totalHits,
			hitRate: totalHits / totalRequests,
			entries,
		};
	}

	/**
	 * Check if a tokenizer is cached
	 */
	has(config: TokenizerConfig): boolean {
		const cacheKey = this.generateCacheKey(config);
		return this.cache.has(cacheKey);
	}

	/**
	 * Get current cache size
	 */
	size(): number {
		return this.cache.size;
	}
}

/**
 * Convenience function to get the global tokenizer cache instance
 */
export const getTokenizerCache = (): TokenizerCache => {
	return TokenizerCache.getInstance();
};
