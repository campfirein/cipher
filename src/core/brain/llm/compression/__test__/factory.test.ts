import { describe, it, expect } from 'vitest';
import { createCompressionStrategy, getCompressionConfigForProvider } from '../factory.js';
import { MiddleRemovalStrategy } from '../strategies/middle-removal.js';
import { OldestRemovalStrategy } from '../strategies/oldest-removal.js';
import { HybridStrategy } from '../strategies/hybrid.js';
import { CompressionConfigSchema } from '../types.js';

describe('Compression Factory', () => {
	describe('createCompressionStrategy', () => {
		it('should create MiddleRemovalStrategy', () => {
			const config = {
				strategy: 'middle-removal' as const,
				maxTokens: 4096,
				warningThreshold: 0.8,
				compressionThreshold: 0.9,
				preserveStart: 4,
				preserveEnd: 5,
				minMessagesToKeep: 4,
			};

			const strategy = createCompressionStrategy(config);
			expect(strategy).toBeInstanceOf(MiddleRemovalStrategy);
			expect(strategy.name).toBe('middle-removal');
		});

		it('should create OldestRemovalStrategy', () => {
			const config = {
				strategy: 'oldest-removal' as const,
				maxTokens: 4096,
				warningThreshold: 0.8,
				compressionThreshold: 0.9,
				preserveStart: 4,
				preserveEnd: 5,
				minMessagesToKeep: 4,
			};

			const strategy = createCompressionStrategy(config);
			expect(strategy).toBeInstanceOf(OldestRemovalStrategy);
			expect(strategy.name).toBe('oldest-removal');
		});

		it('should create HybridStrategy', () => {
			const config = {
				strategy: 'hybrid' as const,
				maxTokens: 4096,
				warningThreshold: 0.8,
				compressionThreshold: 0.9,
				preserveStart: 4,
				preserveEnd: 5,
				minMessagesToKeep: 4,
			};

			const strategy = createCompressionStrategy(config);
			expect(strategy).toBeInstanceOf(HybridStrategy);
			expect(strategy.name).toBe('hybrid');
		});

		it('should validate config schema', () => {
			const invalidConfig = {
				strategy: 'invalid-strategy',
				maxTokens: -100, // Invalid negative value
			};

			expect(() => createCompressionStrategy(invalidConfig as any)).toThrow();
		});
	});

	describe('getCompressionConfigForProvider', () => {
		it('should return optimized config for OpenAI GPT-4', () => {
			const config = getCompressionConfigForProvider('openai', 'gpt-4', 8192);
			expect(config.strategy).toBe('hybrid');
			expect(config.preserveStart).toBe(6);
			expect(config.preserveEnd).toBe(6);
			expect(config.warningThreshold).toBe(0.85);
		});

		it('should return optimized config for OpenAI o1 models', () => {
			const config = getCompressionConfigForProvider('openai', 'o1-preview', 128000);
			expect(config.strategy).toBe('middle-removal');
			expect(config.preserveStart).toBe(8);
			expect(config.preserveEnd).toBe(8);
			expect(config.warningThreshold).toBe(0.9);
			expect(config.compressionThreshold).toBe(0.95);
		});

		it('should return optimized config for Anthropic Claude', () => {
			const config = getCompressionConfigForProvider('anthropic', 'claude-3-sonnet', 200000);
			expect(config.strategy).toBe('oldest-removal');
			expect(config.preserveStart).toBe(5);
			expect(config.preserveEnd).toBe(7);
			expect(config.warningThreshold).toBe(0.85);
			expect(config.compressionThreshold).toBe(0.92);
		});

		it('should return optimized config for Google Gemini 1.5', () => {
			const config = getCompressionConfigForProvider('google', 'gemini-1.5-pro', 1000000);
			expect(config.strategy).toBe('middle-removal');
			expect(config.warningThreshold).toBe(0.9);
			expect(config.compressionThreshold).toBe(0.95);
			expect(config.preserveStart).toBe(10);
			expect(config.preserveEnd).toBe(10);
		});

		it('should return optimized config for LM Studio', () => {
			const config = getCompressionConfigForProvider('lmstudio', 'mistral-7b-instruct', 4096);
			expect(config.strategy).toBe('hybrid');
			expect(config.warningThreshold).toBe(0.7);
			expect(config.compressionThreshold).toBe(0.8);
			expect(config.preserveStart).toBe(3);
			expect(config.preserveEnd).toBe(4);
			expect(config.minMessagesToKeep).toBe(3);
		});

		it('should return optimized config for Ollama', () => {
			const config = getCompressionConfigForProvider('ollama', 'llama3.1:8b', 4096);
			expect(config.strategy).toBe('hybrid');
			expect(config.warningThreshold).toBe(0.7);
			expect(config.compressionThreshold).toBe(0.8);
			expect(config.preserveStart).toBe(3);
			expect(config.preserveEnd).toBe(4);
			expect(config.minMessagesToKeep).toBe(3);
		});

		it('should return default config for unknown providers', () => {
			const config = getCompressionConfigForProvider('unknown', 'unknown-model', 4096);
			expect(config.strategy).toBe('hybrid');
			expect(config.maxTokens).toBe(4096);
			expect(config.warningThreshold).toBe(0.8);
		});
	});

	describe('CompressionConfigSchema validation', () => {
		it('should validate correct config', () => {
			const validConfig = {
				strategy: 'middle-removal',
				maxTokens: 4096,
				warningThreshold: 0.8,
				compressionThreshold: 0.9,
				preserveStart: 4,
				preserveEnd: 5,
				minMessagesToKeep: 4,
			};

			expect(() => CompressionConfigSchema.parse(validConfig)).not.toThrow();
		});

		it('should apply defaults for optional fields', () => {
			const minimalConfig = {
				strategy: 'hybrid',
				maxTokens: 4096,
			};

			const parsed = CompressionConfigSchema.parse(minimalConfig);
			expect(parsed.warningThreshold).toBe(0.8);
			expect(parsed.compressionThreshold).toBe(0.9);
			expect(parsed.preserveStart).toBe(4);
			expect(parsed.preserveEnd).toBe(5);
			expect(parsed.minMessagesToKeep).toBe(4);
		});

		it('should reject invalid values', () => {
			const invalidConfig = {
				strategy: 'invalid',
				maxTokens: -100,
				warningThreshold: 2.0, // > 1
			};

			expect(() => CompressionConfigSchema.parse(invalidConfig)).toThrow();
		});
	});
});
