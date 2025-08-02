import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TokenizerCache, getTokenizerCache } from '../cache.js';
import { ITokenizer, TokenizerConfig } from '../types.js';

// Mock tokenizer for testing
class MockTokenizer implements ITokenizer {
	constructor(
		public provider: string,
		public model: string,
		private creationId = Math.random()
	) {}

	async countTokens(): Promise<any> {
		return {
			total: 100,
			characters: 400,
			estimated: false,
			provider: this.provider,
			model: this.model,
		};
	}

	async countMessages(): Promise<any> {
		return {
			total: 200,
			characters: 800,
			estimated: false,
			provider: this.provider,
			model: this.model,
		};
	}

	getMaxTokens(): number {
		return 4096;
	}
	getContextWindow(): number {
		return 4096;
	}
	estimateTokens(): number {
		return 100;
	}
	isWithinLimit(): boolean {
		return true;
	}
	getRemainingTokens(): number {
		return 3996;
	}

	// Helper to verify instance uniqueness
	getCreationId(): number {
		return this.creationId;
	}
}

describe('TokenizerCache', () => {
	let cache: TokenizerCache;
	let mockFactory: vi.MockedFunction<(config: TokenizerConfig) => ITokenizer>;

	beforeEach(() => {
		// Clear any existing cache instance
		(TokenizerCache as any).instance = null;
		cache = TokenizerCache.getInstance();
		cache.clear();

		// Mock factory function
		mockFactory = vi.fn((config: TokenizerConfig) => {
			return new MockTokenizer(config.provider, config.model || 'default');
		});
	});

	afterEach(() => {
		cache.clear();
		vi.clearAllMocks();
	});

	describe('Singleton Pattern', () => {
		it('should return the same instance', () => {
			const instance1 = TokenizerCache.getInstance();
			const instance2 = TokenizerCache.getInstance();
			const instance3 = getTokenizerCache();

			expect(instance1).toBe(instance2);
			expect(instance2).toBe(instance3);
		});

		it('should maintain cache across getInstance calls', () => {
			const config: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			const instance1 = TokenizerCache.getInstance();
			const tokenizer1 = instance1.get(config, mockFactory);

			const instance2 = TokenizerCache.getInstance();
			const tokenizer2 = instance2.get(config, mockFactory);

			expect(tokenizer1).toBe(tokenizer2);
			expect(mockFactory).toHaveBeenCalledTimes(1);
		});
	});

	describe('Cache Operations', () => {
		it('should cache tokenizer on first access', () => {
			const config: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			expect(cache.has(config)).toBe(false);
			expect(cache.size()).toBe(0);

			const tokenizer = cache.get(config, mockFactory);

			expect(mockFactory).toHaveBeenCalledTimes(1);
			expect(mockFactory).toHaveBeenCalledWith(config);
			expect(cache.has(config)).toBe(true);
			expect(cache.size()).toBe(1);
			expect(tokenizer).toBeInstanceOf(MockTokenizer);
		});

		it('should return cached tokenizer on subsequent access', () => {
			const config: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			const tokenizer1 = cache.get(config, mockFactory);
			const tokenizer2 = cache.get(config, mockFactory);
			const tokenizer3 = cache.get(config, mockFactory);

			expect(tokenizer1).toBe(tokenizer2);
			expect(tokenizer2).toBe(tokenizer3);
			expect(mockFactory).toHaveBeenCalledTimes(1);
			expect(cache.size()).toBe(1);
		});

		it('should create different tokenizers for different configs', () => {
			const config1: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};
			const config2: TokenizerConfig = {
				provider: 'anthropic',
				model: 'claude-3',
				fallbackToApproximation: true,
				hybridTracking: true,
			};
			const config3: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-3.5',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			const tokenizer1 = cache.get(config1, mockFactory);
			const tokenizer2 = cache.get(config2, mockFactory);
			const tokenizer3 = cache.get(config3, mockFactory);

			expect(tokenizer1).not.toBe(tokenizer2);
			expect(tokenizer2).not.toBe(tokenizer3);
			expect(tokenizer1).not.toBe(tokenizer3);
			expect(mockFactory).toHaveBeenCalledTimes(3);
			expect(cache.size()).toBe(3);
		});

		it('should handle configuration variations correctly', () => {
			const baseConfig: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};
			const configWithDefaults: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};
			const configWithDifferentDefaults: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: false,
				hybridTracking: false,
			};

			const tokenizer1 = cache.get(baseConfig, mockFactory);
			const tokenizer2 = cache.get(configWithDefaults, mockFactory);
			const tokenizer3 = cache.get(configWithDifferentDefaults, mockFactory);

			// Base config and configWithDefaults are identical, so they should return the same instance
			expect(tokenizer1).toBe(tokenizer2);
			// configWithDifferentDefaults has different values, so it should be a different instance
			expect(tokenizer1).not.toBe(tokenizer3);
			expect(tokenizer2).not.toBe(tokenizer3);
			expect(mockFactory).toHaveBeenCalledTimes(2); // Called twice: once for identical configs, once for different config
		});
	});

	describe('Cache Management', () => {
		it('should enforce maximum cache size with LRU eviction', async () => {
			// Mock the max cache size to a smaller value for testing
			const originalMaxSize = (cache as any).maxCacheSize;
			(cache as any).maxCacheSize = 3;

			try {
				// Fill cache to capacity
				const config0: TokenizerConfig = {
					provider: 'openai',
					model: 'gpt-0',
					fallbackToApproximation: true,
					hybridTracking: true,
				};
				const config1: TokenizerConfig = {
					provider: 'openai',
					model: 'gpt-1',
					fallbackToApproximation: true,
					hybridTracking: true,
				};
				const config2: TokenizerConfig = {
					provider: 'openai',
					model: 'gpt-2',
					fallbackToApproximation: true,
					hybridTracking: true,
				};

				cache.get(config0, mockFactory);
				await new Promise(resolve => setTimeout(resolve, 1)); // Small delay to ensure different timestamps
				cache.get(config1, mockFactory);
				await new Promise(resolve => setTimeout(resolve, 1)); // Small delay to ensure different timestamps
				cache.get(config2, mockFactory);

				expect(cache.size()).toBe(3);

				// Access first tokenizer to make it more recently used
				await new Promise(resolve => setTimeout(resolve, 1)); // Small delay to ensure different timestamps
				cache.get(config0, mockFactory); // This should update access time for config0

				// Add fourth tokenizer - should evict least recently used (config1)
				await new Promise(resolve => setTimeout(resolve, 1)); // Small delay to ensure different timestamps
				const config3: TokenizerConfig = {
					provider: 'openai',
					model: 'gpt-3',
					fallbackToApproximation: true,
					hybridTracking: true,
				};
				cache.get(config3, mockFactory);

				expect(cache.size()).toBe(3);
				expect(cache.has(config0)).toBe(true); // Recently accessed, should still be there
				expect(cache.has(config1)).toBe(false); // Should be evicted (least recently used)
				expect(cache.has(config2)).toBe(true); // Should still be there
				expect(cache.has(config3)).toBe(true); // Newly added
			} finally {
				(cache as any).maxCacheSize = originalMaxSize;
			}
		});

		it('should invalidate specific tokenizer', () => {
			const config1: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};
			const config2: TokenizerConfig = {
				provider: 'anthropic',
				model: 'claude-3',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			cache.get(config1, mockFactory);
			cache.get(config2, mockFactory);
			expect(cache.size()).toBe(2);

			const removed = cache.invalidate(config1);

			expect(removed).toBe(true);
			expect(cache.has(config1)).toBe(false);
			expect(cache.has(config2)).toBe(true);
			expect(cache.size()).toBe(1);
		});

		it('should return false when invalidating non-existent tokenizer', () => {
			const config: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};
			const removed = cache.invalidate(config);

			expect(removed).toBe(false);
			expect(cache.size()).toBe(0);
		});

		it('should clear all cached tokenizers', () => {
			// Add multiple tokenizers
			for (let i = 0; i < 5; i++) {
				const config: TokenizerConfig = {
					provider: 'openai',
					model: `gpt-${i}`,
					fallbackToApproximation: true,
					hybridTracking: true,
				};
				cache.get(config, mockFactory);
			}

			expect(cache.size()).toBe(5);

			cache.clear();

			expect(cache.size()).toBe(0);
			expect(mockFactory).toHaveBeenCalledTimes(5); // Should not call factory again
		});
	});

	describe('Statistics and Monitoring', () => {
		it('should track cache hits correctly', () => {
			const config: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			// First access - cache miss
			cache.get(config, mockFactory);

			// Multiple subsequent accesses - cache hits
			cache.get(config, mockFactory);
			cache.get(config, mockFactory);
			cache.get(config, mockFactory);

			const stats = cache.getStats();
			expect(stats.cacheSize).toBe(1);
			expect(stats.totalHits).toBe(4); // 1 initial + 3 hits
			expect(stats.hitRate).toBe(0.8); // 4 hits out of 5 total requests
			expect(stats.entries).toHaveLength(1);
			expect(stats.entries[0]!.hits).toBe(4);
		});

		it('should track multiple tokenizers statistics', () => {
			const config1: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};
			const config2: TokenizerConfig = {
				provider: 'anthropic',
				model: 'claude-3',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			// Access first tokenizer multiple times
			cache.get(config1, mockFactory);
			cache.get(config1, mockFactory);
			cache.get(config1, mockFactory);

			// Access second tokenizer once
			cache.get(config2, mockFactory);

			const stats = cache.getStats();
			expect(stats.cacheSize).toBe(2);
			expect(stats.totalHits).toBe(4); // 3 + 1
			expect(stats.entries).toHaveLength(2);

			// Find entries by hits count
			const firstEntry = stats.entries.find(e => e.hits === 3);
			const secondEntry = stats.entries.find(e => e.hits === 1);

			expect(firstEntry).toBeDefined();
			expect(secondEntry).toBeDefined();
		});

		it('should track last access times', () => {
			const config: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			const beforeTime = Date.now();
			cache.get(config, mockFactory);
			const afterTime = Date.now();

			const stats = cache.getStats();
			expect(stats.entries[0]!.lastAccess).toBeGreaterThanOrEqual(beforeTime);
			expect(stats.entries[0]!.lastAccess).toBeLessThanOrEqual(afterTime);
		});
	});

	describe('Error Handling', () => {
		it('should handle factory function errors gracefully', () => {
			const config: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};
			const errorFactory = vi.fn(() => {
				throw new Error('Factory error');
			});

			expect(() => cache.get(config, errorFactory)).toThrow('Factory error');
			expect(cache.size()).toBe(0);
			expect(cache.has(config)).toBe(false);
		});

		it('should not cache failed tokenizer creation', () => {
			const config: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};
			let shouldFail = true;

			const conditionalFactory = vi.fn((config: TokenizerConfig) => {
				if (shouldFail) {
					throw new Error('Factory error');
				}
				return new MockTokenizer(config.provider, config.model || 'default');
			});

			// First call fails
			expect(() => cache.get(config, conditionalFactory)).toThrow('Factory error');
			expect(cache.size()).toBe(0);

			// Second call succeeds
			shouldFail = false;
			const tokenizer = cache.get(config, conditionalFactory);

			expect(tokenizer).toBeInstanceOf(MockTokenizer);
			expect(cache.size()).toBe(1);
			expect(conditionalFactory).toHaveBeenCalledTimes(2); // Both failed and successful calls
		});
	});

	describe('Thread Safety Simulation', () => {
		it('should handle concurrent access to same config', async () => {
			const config: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			// Simulate concurrent access
			const promises = Array.from({ length: 10 }, () =>
				Promise.resolve(cache.get(config, mockFactory))
			);

			const tokenizers = await Promise.all(promises);

			// All should be the same instance
			const firstTokenizer = tokenizers[0];
			tokenizers.forEach(tokenizer => {
				expect(tokenizer).toBe(firstTokenizer);
			});

			// Factory should only be called once
			expect(mockFactory).toHaveBeenCalledTimes(1);
			expect(cache.size()).toBe(1);
		});
	});
});
