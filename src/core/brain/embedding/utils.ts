/**
 * Embedding Utilities
 *
 * Utility functions for working with embedding configuration and
 * environment variables. Provides convenient access to environment-based
 * configuration for the embedding system.
 *
 * @module embedding/utils
 */

import { env } from '../../env.js';
import { type OpenAIEmbeddingConfig } from './backend/types.js';
import { DEFAULTS } from './constants.js';

/**
 * Get embedding configuration from environment variables
 *
 * Uses the centralized env configuration to build embedding config.
 * Falls back to sensible defaults when environment variables are not set.
 *
 * @returns OpenAI embedding configuration or null if no API key
 *
 * @example
 * ```typescript
 * const config = getEmbeddingConfigFromEnv();
 * if (config) {
 *   const embedder = await createEmbedder(config);
 * }
 * ```
 */
export function getEmbeddingConfigFromEnv(): OpenAIEmbeddingConfig | null {
	// Check if we have a required API key
	if (!env.OPENAI_API_KEY) {
		return null;
	}

	const config: OpenAIEmbeddingConfig = {
		type: 'openai',
		apiKey: env.OPENAI_API_KEY!,
		model: (env.EMBEDDING_MODEL as any) || DEFAULTS.OPENAI_MODEL,
		baseUrl: env.OPENAI_BASE_URL || DEFAULTS.OPENAI_BASE_URL,
		timeout: env.EMBEDDING_TIMEOUT || DEFAULTS.TIMEOUT,
		maxRetries: env.EMBEDDING_MAX_RETRIES || DEFAULTS.MAX_RETRIES,
		organization: env.OPENAI_ORG_ID || '',
	};

	return config;
}

/**
 * Check if embedding configuration is available in environment
 *
 * @returns True if embedding can be configured from environment variables
 *
 * @example
 * ```typescript
 * if (isEmbeddingConfigAvailable()) {
 *   const embedder = await createEmbedderFromEnv();
 * } else {
 *   console.log('Please set OPENAI_API_KEY environment variable');
 * }
 * ```
 */
export function isEmbeddingConfigAvailable(): boolean {
	return !!env.OPENAI_API_KEY;
}

/**
 * Get embedding configuration summary for logging/debugging
 *
 * Returns safe configuration info without exposing sensitive data.
 *
 * @returns Configuration summary object
 *
 * @example
 * ```typescript
 * const summary = getEmbeddingConfigSummary();
 * console.log('Embedding config:', summary);
 * // Output: { hasApiKey: true, model: 'text-embedding-3-small', ... }
 * ```
 */
export function getEmbeddingConfigSummary(): {
	hasApiKey: boolean;
	model?: string;
	baseUrl?: string;
	timeout?: number;
	maxRetries?: number;
	hasOrganization: boolean;
} {
	return {
		hasApiKey: !!env.OPENAI_API_KEY,
		model: env.EMBEDDING_MODEL || DEFAULTS.OPENAI_MODEL,
		baseUrl: env.OPENAI_BASE_URL || DEFAULTS.OPENAI_BASE_URL,
		timeout: env.EMBEDDING_TIMEOUT || DEFAULTS.TIMEOUT,
		maxRetries: env.EMBEDDING_MAX_RETRIES || DEFAULTS.MAX_RETRIES,
		hasOrganization: !!env.OPENAI_ORG_ID,
	};
}

/**
 * Validate that required environment variables are set for embeddings
 *
 * @returns Validation result with details
 *
 * @example
 * ```typescript
 * const validation = validateEmbeddingEnv();
 * if (!validation.valid) {
 *   console.error('Embedding setup issues:', validation.issues);
 * }
 * ```
 */
export function validateEmbeddingEnv(): {
	valid: boolean;
	issues: string[];
} {
	const issues: string[] = [];

	// Check required variables
	if (!env.OPENAI_API_KEY) {
		// Check if other LLM providers are configured
		const hasOtherProviders = env.ANTHROPIC_API_KEY || env.GEMINI_API_KEY || env.OPENROUTER_API_KEY;
		if (hasOtherProviders) {
			issues.push(
				'OPENAI_API_KEY is required for embedding functionality, even when using Anthropic, Gemini, or OpenRouter for LLM services'
			);
		} else {
			issues.push('OPENAI_API_KEY is required for embedding functionality');
		}
	}

	// Check API key format
	if (env.OPENAI_API_KEY && !env.OPENAI_API_KEY.startsWith('sk-')) {
		issues.push('OPENAI_API_KEY should start with "sk-"');
	}

	// Check numeric values
	if (env.EMBEDDING_TIMEOUT && env.EMBEDDING_TIMEOUT <= 0) {
		issues.push('EMBEDDING_TIMEOUT must be a positive number');
	}

	if (env.EMBEDDING_MAX_RETRIES && env.EMBEDDING_MAX_RETRIES < 0) {
		issues.push('EMBEDDING_MAX_RETRIES must be a non-negative number');
	}

	// Check URL format
	if (env.OPENAI_BASE_URL) {
		try {
			new URL(env.OPENAI_BASE_URL);
		} catch {
			issues.push('OPENAI_BASE_URL must be a valid URL');
		}
	}

	return {
		valid: issues.length === 0,
		issues,
	};
}

/**
 * Check for mixed provider configuration and provide helpful guidance
 *
 * @returns Configuration analysis with recommendations
 *
 * @example
 * ```typescript
 * const analysis = analyzeProviderConfiguration();
 * if (analysis.warnings.length > 0) {
 *   console.warn('Configuration warnings:', analysis.warnings);
 * }
 * ```
 */
export function analyzeProviderConfiguration(): {
	usingMixedProviders: boolean;
	llmProvider: 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'none' | 'multiple';
	embeddingProvider: 'openai' | 'none';
	warnings: string[];
	recommendations: string[];
} {
	const warnings: string[] = [];
	const recommendations: string[] = [];

	// Detect which LLM providers are configured
	const hasOpenAI = !!env.OPENAI_API_KEY;
	const hasAnthropic = !!env.ANTHROPIC_API_KEY;
	const hasOpenRouter = !!env.OPENROUTER_API_KEY;

	let llmProvider: 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'none' | 'multiple';
	const hasGemini = !!env.GEMINI_API_KEY;
	const configuredProviders = [
		hasOpenAI && 'openai',
		hasAnthropic && 'anthropic',
		hasGemini && 'gemini',
		hasOpenRouter && 'openrouter',
	].filter(Boolean);

	if (configuredProviders.length === 0) {
		llmProvider = 'none';
		warnings.push('No LLM provider API keys configured');
	} else if (configuredProviders.length === 1) {
		llmProvider = configuredProviders[0] as 'openai' | 'anthropic' | 'gemini' | 'openrouter';
	} else {
		llmProvider = 'multiple';
		recommendations.push(
			'Multiple LLM provider API keys detected. The system will use the configured provider in your LLM service setup.'
		);
	}

	// Embedding provider analysis
	const embeddingProvider = hasOpenAI ? 'openai' : 'none';
	const usingMixedProviders = (hasAnthropic || hasGemini || hasOpenRouter) && hasOpenAI;

	// Generate specific warnings and recommendations
	if (!hasOpenAI && (hasAnthropic || hasGemini || hasOpenRouter)) {
		warnings.push('Embedding functionality will not work without OPENAI_API_KEY');
		recommendations.push(
			'Add OPENAI_API_KEY to enable embedding features, even when using Anthropic, Gemini, or OpenRouter for LLM'
		);
	}

	if (usingMixedProviders) {
		recommendations.push(
			'You are using a mixed provider setup (non-OpenAI for LLM + OpenAI for embeddings). This is a valid configuration.'
		);
	}

	if (hasOpenAI && !hasAnthropic && !hasGemini && !hasOpenRouter) {
		recommendations.push(
			'Using OpenAI for both LLM and embeddings - this is the simplest configuration.'
		);
	}

	return {
		usingMixedProviders,
		llmProvider,
		embeddingProvider,
		warnings,
		recommendations,
	};
}
