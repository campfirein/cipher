import { describe, it, expect } from 'vitest';
import { createTokenizer, getTokenizerConfigForModel } from '../factory.js';
import { OpenAITokenizer } from '../providers/openai.js';
import { AnthropicTokenizer } from '../providers/anthropic.js';
import { GoogleTokenizer } from '../providers/google.js';
import { DefaultTokenizer } from '../providers/default.js';
import { TokenizerConfigSchema } from '../types.js';

describe('Tokenizer Factory', () => {
	describe('createTokenizer', () => {
		it('should create OpenAI tokenizer for openai provider', () => {
			const config = {
				provider: 'openai' as const,
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			const tokenizer = createTokenizer(config);
			expect(tokenizer).toBeInstanceOf(OpenAITokenizer);
			expect(tokenizer.provider).toBe('openai');
			expect(tokenizer.model).toBe('gpt-4');
		});

		it('should create Anthropic tokenizer for anthropic provider', () => {
			const config = {
				provider: 'anthropic' as const,
				model: 'claude-3-sonnet',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			const tokenizer = createTokenizer(config);
			expect(tokenizer).toBeInstanceOf(AnthropicTokenizer);
			expect(tokenizer.provider).toBe('anthropic');
		});

		it('should create Google tokenizer for google provider', () => {
			const config = {
				provider: 'google' as const,
				model: 'gemini-pro',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			const tokenizer = createTokenizer(config);
			expect(tokenizer).toBeInstanceOf(GoogleTokenizer);
			expect(tokenizer.provider).toBe('google');
		});

		it('should create Default tokenizer for default provider', () => {
			const config = {
				provider: 'default' as const,
				model: 'unknown-model',
				fallbackToApproximation: true,
				hybridTracking: false,
			};

			const tokenizer = createTokenizer(config);
			expect(tokenizer).toBeInstanceOf(DefaultTokenizer);
			expect(tokenizer.provider).toBe('default');
		});

		it('should validate config schema', () => {
			const invalidConfig = {
				provider: 'invalid-provider',
				model: 'test-model',
			};

			expect(() => createTokenizer(invalidConfig as any)).toThrow();
		});
	});

	describe('getTokenizerConfigForModel', () => {
		it('should return OpenAI config for GPT models', () => {
			const gptConfig = getTokenizerConfigForModel('gpt-4');
			expect(gptConfig.provider).toBe('openai');
			expect(gptConfig.model).toBe('gpt-4');
			expect(gptConfig.hybridTracking).toBe(true);

			const o1Config = getTokenizerConfigForModel('o1-preview');
			expect(o1Config.provider).toBe('openai');
			expect(o1Config.model).toBe('o1-preview');
		});

		it('should return Anthropic config for Claude models', () => {
			const claudeConfig = getTokenizerConfigForModel('claude-3-sonnet');
			expect(claudeConfig.provider).toBe('anthropic');
			expect(claudeConfig.model).toBe('claude-3-sonnet');
			expect(claudeConfig.hybridTracking).toBe(true);
		});

		it('should return Google config for Gemini models', () => {
			const geminiConfig = getTokenizerConfigForModel('gemini-pro');
			expect(geminiConfig.provider).toBe('google');
			expect(geminiConfig.model).toBe('gemini-pro');
			expect(geminiConfig.hybridTracking).toBe(true);
		});

		it('should return OpenAI config for LM Studio models', () => {
			const llamaConfig = getTokenizerConfigForModel('llama-3.1-8b-instruct');
			expect(llamaConfig.provider).toBe('openai');
			expect(llamaConfig.model).toBe('llama-3.1-8b-instruct');
			expect(llamaConfig.hybridTracking).toBe(true);

			const mistralConfig = getTokenizerConfigForModel('mistral-7b-instruct');
			expect(mistralConfig.provider).toBe('openai');
			expect(mistralConfig.model).toBe('mistral-7b-instruct');
			expect(mistralConfig.hybridTracking).toBe(true);
		});

		it('should return default config for unknown models', () => {
			const unknownConfig = getTokenizerConfigForModel('unknown-model');
			expect(unknownConfig.provider).toBe('default');
			expect(unknownConfig.model).toBe('unknown-model');
			expect(unknownConfig.hybridTracking).toBe(false);
		});
	});

	describe('TokenizerConfigSchema validation', () => {
		it('should validate correct config', () => {
			const validConfig = {
				provider: 'openai',
				model: 'gpt-4',
				fallbackToApproximation: true,
				hybridTracking: true,
			};

			expect(() => TokenizerConfigSchema.parse(validConfig)).not.toThrow();
		});

		it('should apply defaults for optional fields', () => {
			const minimalConfig = {
				provider: 'openai',
			};

			const parsed = TokenizerConfigSchema.parse(minimalConfig);
			expect(parsed.fallbackToApproximation).toBe(true);
			expect(parsed.hybridTracking).toBe(true);
		});

		it('should reject invalid provider', () => {
			const invalidConfig = {
				provider: 'invalid',
			};

			expect(() => TokenizerConfigSchema.parse(invalidConfig)).toThrow();
		});
	});
});
