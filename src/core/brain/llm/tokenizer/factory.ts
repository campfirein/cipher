import { ITokenizer, TokenizerConfigSchema, TokenizerConfig } from './types.js';
import { OpenAITokenizer } from './providers/openai.js';
import { AnthropicTokenizer } from './providers/anthropic.js';
import { GoogleTokenizer } from './providers/google.js';
import { DefaultTokenizer } from './providers/default.js';
import { logger } from '../../../logger/index.js';
import { getTokenizerCache } from './cache.js';

/**
 * Create a tokenizer instance based on provider configuration
 * Uses caching to avoid redundant tokenizer creation
 */
export function createTokenizer(config: TokenizerConfig): ITokenizer {
	const validatedConfig = TokenizerConfigSchema.parse(config);

	// Use cache to get or create tokenizer
	const cache = getTokenizerCache();
	return cache.get(validatedConfig, config => {
		logger.debug('Creating tokenizer', {
			provider: config.provider,
			model: config.model,
		});

		switch (config.provider) {
			case 'openai':
				return new OpenAITokenizer(config);
			case 'anthropic':
				return new AnthropicTokenizer(config);
			case 'google':
				return new GoogleTokenizer(config);
			case 'default':
			default:
				logger.warn('Using default tokenizer, token counting may be less accurate');
				return new DefaultTokenizer(config);
		}
	});
}

/**
 * Get recommended tokenizer config for a given model
 */
export function getTokenizerConfigForModel(model: string): TokenizerConfig {
	if (model.startsWith('gpt-') || model.startsWith('o1-') || model.includes('openai')) {
		return {
			provider: 'openai',
			model,
			fallbackToApproximation: true,
			hybridTracking: true,
		};
	}

	if (model.startsWith('claude-') || model.includes('anthropic')) {
		return {
			provider: 'anthropic',
			model,
			fallbackToApproximation: true,
			hybridTracking: true,
		};
	}

	if (model.startsWith('gemini-') || model.includes('google')) {
		return {
			provider: 'google',
			model,
			fallbackToApproximation: true,
			hybridTracking: true,
		};
	}

	if (model.startsWith('qwen') || model.includes('qwen')) {
		return {
			provider: 'openai', // Qwen uses OpenAI-compatible tokenization
			model,
			fallbackToApproximation: true,
			hybridTracking: true,
		};
	}

	// LM Studio models use OpenAI-compatible tokenization
	if (model.includes('lmstudio') || model.includes('llama') || model.includes('mistral')) {
		return {
			provider: 'openai', // LM Studio uses OpenAI-compatible tokenization
			model,
			fallbackToApproximation: true,
			hybridTracking: true,
		};
	}

	return {
		provider: 'default',
		model,
		fallbackToApproximation: true,
		hybridTracking: false,
	};
}
