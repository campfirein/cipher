import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { performance } from 'node:perf_hooks';
import { createTokenizer, getTokenizerConfigForModel } from '../factory.js';
import { getTokenizerCache } from '../cache.js';
import { TokenizerConfig } from '../types.js';

// Mock the actual tokenizer providers to avoid external dependencies
vi.mock('../providers/openai.js', () => ({
	OpenAITokenizer: vi.fn().mockImplementation(config => ({
		provider: config.provider,
		model: config.model,
		countTokens: vi.fn().mockResolvedValue({
			total: 100,
			characters: 400,
			estimated: false,
			provider: config.provider,
			model: config.model,
		}),
		countMessages: vi.fn().mockResolvedValue({
			total: 200,
			characters: 800,
			estimated: false,
			provider: config.provider,
			model: config.model,
		}),
		getMaxTokens: vi.fn().mockReturnValue(4096),
		getContextWindow: vi.fn().mockReturnValue(4096),
		estimateTokens: vi.fn().mockReturnValue(100),
		isWithinLimit: vi.fn().mockReturnValue(true),
		getRemainingTokens: vi.fn().mockReturnValue(3996),
		_mockId: Math.random(), // For instance comparison
	})),
}));

vi.mock('../providers/anthropic.js', () => ({
	AnthropicTokenizer: vi.fn().mockImplementation(config => ({
		provider: config.provider,
		model: config.model,
		countTokens: vi.fn().mockResolvedValue({
			total: 120,
			characters: 480,
			estimated: false,
			provider: config.provider,
			model: config.model,
		}),
		countMessages: vi.fn().mockResolvedValue({
			total: 240,
			characters: 960,
			estimated: false,
			provider: config.provider,
			model: config.model,
		}),
		getMaxTokens: vi.fn().mockReturnValue(8192),
		getContextWindow: vi.fn().mockReturnValue(8192),
		estimateTokens: vi.fn().mockReturnValue(120),
		isWithinLimit: vi.fn().mockReturnValue(true),
		getRemainingTokens: vi.fn().mockReturnValue(8072),
		_mockId: Math.random(),
	})),
}));

vi.mock('../providers/google.js', () => ({
	GoogleTokenizer: vi.fn().mockImplementation(config => ({
		provider: config.provider,
		model: config.model,
		countTokens: vi.fn().mockResolvedValue({
			total: 90,
			characters: 360,
			estimated: false,
			provider: config.provider,
			model: config.model,
		}),
		countMessages: vi.fn().mockResolvedValue({
			total: 180,
			characters: 720,
			estimated: false,
			provider: config.provider,
			model: config.model,
		}),
		getMaxTokens: vi.fn().mockReturnValue(2048),
		getContextWindow: vi.fn().mockReturnValue(2048),
		estimateTokens: vi.fn().mockReturnValue(90),
		isWithinLimit: vi.fn().mockReturnValue(true),
		getRemainingTokens: vi.fn().mockReturnValue(1958),
		_mockId: Math.random(),
	})),
}));

vi.mock('../providers/default.js', () => ({
	DefaultTokenizer: vi.fn().mockImplementation(config => ({
		provider: config.provider,
		model: config.model,
		countTokens: vi.fn().mockResolvedValue({
			total: 80,
			characters: 320,
			estimated: true,
			provider: config.provider,
			model: config.model,
		}),
		countMessages: vi.fn().mockResolvedValue({
			total: 160,
			characters: 640,
			estimated: true,
			provider: config.provider,
			model: config.model,
		}),
		getMaxTokens: vi.fn().mockReturnValue(1024),
		getContextWindow: vi.fn().mockReturnValue(1024),
		estimateTokens: vi.fn().mockReturnValue(80),
		isWithinLimit: vi.fn().mockReturnValue(true),
		getRemainingTokens: vi.fn().mockReturnValue(944),
		_mockId: Math.random(),
	})),
}));

describe('Factory Integration with Cache', () => {
	let mockOpenAITokenizer: any;
	let mockAnthropicTokenizer: any;
	let mockGoogleTokenizer: any;
	let mockDefaultTokenizer: any;

	beforeEach(async () => {
		// Clear cache before each test
		const cache = getTokenizerCache();
		cache.clear();
		vi.clearAllMocks();

		// Get mocked constructors
		const openaiModule = await import('../providers/openai.js');
		const anthropicModule = await import('../providers/anthropic.js');
		const googleModule = await import('../providers/google.js');
		const defaultModule = await import('../providers/default.js');

		mockOpenAITokenizer = openaiModule.OpenAITokenizer as any;
		mockAnthropicTokenizer = anthropicModule.AnthropicTokenizer as any;
		mockGoogleTokenizer = googleModule.GoogleTokenizer as any;
		mockDefaultTokenizer = defaultModule.DefaultTokenizer as any;
	});

	afterEach(() => {
		const cache = getTokenizerCache();
		cache.clear();
	});

	describe('createTokenizer with Caching', () => {
		it('should cache tokenizer instances', () => {
			const config: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			const tokenizer1 = createTokenizer(config);
			const tokenizer2 = createTokenizer(config);
			const tokenizer3 = createTokenizer(config);

			// Should return the same instance
			expect(tokenizer1).toBe(tokenizer2);
			expect(tokenizer2).toBe(tokenizer3);

			// Mock constructor should only be called once
			expect(mockOpenAITokenizer).toHaveBeenCalledTimes(1);
			// Config will have defaults applied by schema
			expect(mockOpenAITokenizer).toHaveBeenCalledWith({
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			});
		});

		it('should create different instances for different providers', () => {
			const openaiConfig: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};
			const anthropicConfig: TokenizerConfig = {
				provider: 'anthropic',
				model: 'claude-3',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			const openaiTokenizer = createTokenizer(openaiConfig);
			const anthropicTokenizer = createTokenizer(anthropicConfig);

			expect(openaiTokenizer).not.toBe(anthropicTokenizer);
			expect(openaiTokenizer.provider).toBe('openai');
			expect(anthropicTokenizer.provider).toBe('anthropic');

			expect(mockOpenAITokenizer).toHaveBeenCalledTimes(1);
			expect(mockAnthropicTokenizer).toHaveBeenCalledTimes(1);
		});

		it('should create different instances for different models', () => {
			const gpt4Config: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};
			const gpt35Config: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-3.5-turbo',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			const gpt4Tokenizer = createTokenizer(gpt4Config);
			const gpt35Tokenizer = createTokenizer(gpt35Config);

			expect(gpt4Tokenizer).not.toBe(gpt35Tokenizer);
			expect(gpt4Tokenizer.model).toBe('gpt-4');
			expect(gpt35Tokenizer.model).toBe('gpt-3.5-turbo');

			expect(mockOpenAITokenizer).toHaveBeenCalledTimes(2);
		});

		it('should handle all provider types', () => {
			const providers: Array<TokenizerConfig> = [
				{ provider: 'openai', model: 'gpt-4', fallbackToApproximation: true, hybridTracking: true },
				{
					provider: 'anthropic',
					model: 'claude-3',
					fallbackToApproximation: true,
					hybridTracking: true,
				},
				{
					provider: 'google',
					model: 'gemini-pro',
					fallbackToApproximation: true,
					hybridTracking: true,
				},
				{
					provider: 'default',
					model: 'unknown-model',
					fallbackToApproximation: true,
					hybridTracking: true,
				},
			];

			const tokenizers = providers.map(config => createTokenizer(config));

			// Each should be different
			for (let i = 0; i < tokenizers.length; i++) {
				for (let j = i + 1; j < tokenizers.length; j++) {
					expect(tokenizers[i]).not.toBe(tokenizers[j]);
				}
			}

			// Verify provider-specific behavior
			expect(tokenizers[0]!.provider).toBe('openai');
			expect(tokenizers[1]!.provider).toBe('anthropic');
			expect(tokenizers[2]!.provider).toBe('google');
			expect(tokenizers[3]!.provider).toBe('default');

			// Verify each constructor was called once
			expect(mockOpenAITokenizer).toHaveBeenCalledTimes(1);
			expect(mockAnthropicTokenizer).toHaveBeenCalledTimes(1);
			expect(mockGoogleTokenizer).toHaveBeenCalledTimes(1);
			expect(mockDefaultTokenizer).toHaveBeenCalledTimes(1);
		});
	});

	describe('getTokenizerConfigForModel Integration', () => {
		it('should cache tokenizers created from config recommendations', () => {
			const gptConfig = getTokenizerConfigForModel('gpt-4');
			const claudeConfig = getTokenizerConfigForModel('claude-3-opus');
			const geminiConfig = getTokenizerConfigForModel('gemini-pro');

			// Create tokenizers multiple times
			const gpt1 = createTokenizer(gptConfig);
			const gpt2 = createTokenizer(gptConfig);
			const claude1 = createTokenizer(claudeConfig);
			const claude2 = createTokenizer(claudeConfig);
			const gemini1 = createTokenizer(geminiConfig);
			const gemini2 = createTokenizer(geminiConfig);

			// Should cache same configs
			expect(gpt1).toBe(gpt2);
			expect(claude1).toBe(claude2);
			expect(gemini1).toBe(gemini2);

			// But different providers should be different
			expect(gpt1).not.toBe(claude1);
			expect(claude1).not.toBe(gemini1);
			expect(gpt1).not.toBe(gemini1);
		});

		it('should handle model variations correctly', () => {
			const models = [
				'gpt-4',
				'gpt-4-turbo',
				'gpt-3.5-turbo',
				'claude-3-opus',
				'claude-3-sonnet',
				'gemini-pro',
				'gemini-2.0-flash',
				'unknown-model',
			];

			const configs = models.map(model => getTokenizerConfigForModel(model));
			const tokenizers = configs.map(config => createTokenizer(config));

			// Verify correct provider assignment
			expect(tokenizers[0]!.provider).toBe('openai'); // gpt-4
			expect(tokenizers[1]!.provider).toBe('openai'); // gpt-4-turbo
			expect(tokenizers[2]!.provider).toBe('openai'); // gpt-3.5-turbo
			expect(tokenizers[3]!.provider).toBe('anthropic'); // claude-3-opus
			expect(tokenizers[4]!.provider).toBe('anthropic'); // claude-3-sonnet
			expect(tokenizers[5]!.provider).toBe('google'); // gemini-pro
			expect(tokenizers[6]!.provider).toBe('google'); // gemini-2.0-flash
			expect(tokenizers[7]!.provider).toBe('default'); // unknown-model

			// Verify caching works across different models of same provider
			const gpt4Again = createTokenizer(getTokenizerConfigForModel('gpt-4'));
			expect(gpt4Again).toBe(tokenizers[0]!);
		});
	});

	describe('Performance and Memory', () => {
		it('should demonstrate caching performance benefits', () => {
			const config: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			// Measure time for first creation (cache miss)
			const start1 = performance.now();
			const tokenizer1 = createTokenizer(config);
			const time1 = performance.now() - start1;

			// Measure time for subsequent creations (cache hits)
			const start2 = performance.now();
			const tokenizer2 = createTokenizer(config);
			const time2 = performance.now() - start2;

			const start3 = performance.now();
			const tokenizer3 = createTokenizer(config);
			const time3 = performance.now() - start3;

			// Cache hits should be significantly faster
			expect(tokenizer1).toBe(tokenizer2);
			expect(tokenizer2).toBe(tokenizer3);
			expect(time2).toBeLessThan(time1); // Cache hit should be faster
			expect(time3).toBeLessThan(time1); // Cache hit should be faster

			expect(mockOpenAITokenizer).toHaveBeenCalledTimes(1);
		});

		it('should handle many different configurations efficiently', () => {
			const cache = getTokenizerCache();
			const initialStats = cache.getStats();

			// Create many different tokenizer configurations
			const configs: TokenizerConfig[] = [];
			for (let i = 0; i < 20; i++) {
				configs.push({
					provider: i % 2 === 0 ? 'openai' : 'anthropic',
					model: `model-${i}`,
					fallbackToApproximation: i % 3 === 0,
					hybridTracking: i % 4 === 0,
				});
			}

			// Create tokenizers
			const tokenizers = configs.map(config => createTokenizer(config));

			// Access some tokenizers multiple times to test hit tracking
			createTokenizer(configs[0]!); // Should be cache hit
			createTokenizer(configs[5]!); // Should be cache hit
			createTokenizer(configs[10]!); // Should be cache hit

			const finalStats = cache.getStats();

			expect(finalStats.cacheSize).toBeGreaterThan(initialStats.cacheSize);
			expect(finalStats.totalHits).toBeGreaterThan(3); // At least the 3 repeated accesses
			expect(finalStats.hitRate).toBeGreaterThan(0); // Should have some cache hits

			// Verify all created tokenizers are different
			for (let i = 0; i < tokenizers.length; i++) {
				for (let j = i + 1; j < tokenizers.length; j++) {
					if (JSON.stringify(configs[i]) !== JSON.stringify(configs[j])) {
						expect(tokenizers[i]).not.toBe(tokenizers[j]);
					}
				}
			}
		});
	});

	describe('Error Handling Integration', () => {
		it('should not cache failed tokenizer creation', () => {
			// Clear cache first
			const cache = getTokenizerCache();
			cache.clear();

			// Mock a provider to fail on first call, succeed on second
			let callCount = 0;
			mockOpenAITokenizer.mockImplementation((config: TokenizerConfig) => {
				callCount++;
				if (callCount === 1) {
					throw new Error('Initialization failed');
				}
				return {
					provider: config.provider,
					model: config.model,
					countTokens: vi.fn().mockResolvedValue({
						total: 100,
						characters: 400,
						estimated: false,
						provider: config.provider,
						model: config.model,
					}),
					getMaxTokens: vi.fn().mockReturnValue(4096),
					_mockId: Math.random(),
				};
			});

			const config: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};
			// Use the normalized config with defaults that the cache will use
			const normalizedConfig: TokenizerConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			// First call should fail
			expect(() => createTokenizer(config)).toThrow('Initialization failed');

			// Cache should not contain the failed tokenizer (using normalized config for check)
			expect(cache.has(normalizedConfig)).toBe(false);
			expect(cache.size()).toBe(0);

			// Second call should succeed and be cached
			const tokenizer = createTokenizer(config);
			expect(tokenizer).toBeDefined();
			expect(cache.has(normalizedConfig)).toBe(true);
			expect(cache.size()).toBe(1);

			// Third call should use cache
			const cachedTokenizer = createTokenizer(config);
			expect(cachedTokenizer).toBe(tokenizer);

			// Should have called constructor twice (failed + successful)
			expect(mockOpenAITokenizer).toHaveBeenCalledTimes(2);
		});
	});
});
