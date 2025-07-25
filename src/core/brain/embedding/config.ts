/**
 * Embedding Configuration Module
 *
 * Defines the configuration schemas for the embedding system using Zod for
 * runtime validation and type safety. Supports multiple embedding providers
 * with different configuration requirements.
 *
 * @module embedding/config
 */

import { z } from 'zod';
import {
	DEFAULTS,
	OPENAI_MODELS,
	GEMINI_MODELS,
	OLLAMA_MODELS,
	PROVIDER_TYPES,
	ENV_VARS,
} from './constants.js';

/**
 * Base Embedding Configuration Schema
 *
 * Common configuration options shared by all embedding providers.
 * These options control model selection, timeouts, and retry behavior.
 */
const BaseEmbeddingSchema = z.object({
	/** API key for the provider (required for all providers) */
	apiKey: z.string().min(1).describe('API key for the embedding provider'),

	/** Model name to use for embeddings */
	model: z.string().min(1).optional().describe('Model name for embeddings'),

	/** Base URL for the provider API */
	baseUrl: z.string().url().optional().describe('Base URL for the provider API'),

	/** Request timeout in milliseconds */
	timeout: z
		.number()
		.int()
		.positive()
		.max(300000) // 5 minutes max
		.default(DEFAULTS.TIMEOUT)
		.describe('Request timeout in milliseconds'),

	/** Maximum number of retry attempts */
	maxRetries: z
		.number()
		.int()
		.min(0)
		.max(10)
		.default(DEFAULTS.MAX_RETRIES)
		.describe('Maximum retry attempts'),

	/** Provider-specific options */
	options: z.record(z.any()).optional().describe('Provider-specific configuration options'),
});

/**
 * OpenAI Embedding Configuration Schema
 *
 * Configuration specific to OpenAI embedding services.
 * Supports all OpenAI embedding models with validation.
 *
 * @example
 * ```typescript
 * const config: OpenAIEmbeddingConfig = {
 *   type: 'openai',
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'text-embedding-3-small'
 * };
 * ```
 */
const OpenAIEmbeddingSchema = BaseEmbeddingSchema.extend({
	type: z.literal(PROVIDER_TYPES.OPENAI),

	/** OpenAI embedding model */
	model: z
		.enum([
			OPENAI_MODELS.TEXT_EMBEDDING_3_SMALL,
			OPENAI_MODELS.TEXT_EMBEDDING_3_LARGE,
			OPENAI_MODELS.TEXT_EMBEDDING_ADA_002,
		] as const)
		.default(DEFAULTS.OPENAI_MODEL)
		.describe('OpenAI embedding model'),

	/** OpenAI organization ID */
	organization: z.string().optional().describe('OpenAI organization ID'),

	/** Custom dimensions for embedding-3 models */
	dimensions: z
		.number()
		.int()
		.positive()
		.max(3072)
		.optional()
		.describe('Custom embedding dimensions (embedding-3 models only)'),

	/** Base URL override */
	baseUrl: z.string().url().default(DEFAULTS.OPENAI_BASE_URL).describe('OpenAI API base URL'),
}).strict();

export type OpenAIEmbeddingConfig = z.infer<typeof OpenAIEmbeddingSchema>;

/**
 * Gemini Embedding Configuration Schema
 *
 * Configuration specific to Google Gemini embedding services.
 * Supports configurable dimensions for the latest models.
 *
 * @example
 * ```typescript
 * const config: GeminiEmbeddingConfig = {
 *   type: 'gemini',
 *   apiKey: process.env.GEMINI_API_KEY,
 *   model: 'text-embedding-004',
 *   dimensions: 1536
 * };
 * ```
 */
const GeminiEmbeddingSchema = BaseEmbeddingSchema.extend({
	type: z.literal(PROVIDER_TYPES.GEMINI),

	/** Gemini embedding model */
	model: z
		.enum([
			GEMINI_MODELS.TEXT_EMBEDDING_004,
			GEMINI_MODELS.GEMINI_EMBEDDING_001,
			GEMINI_MODELS.EMBEDDING_001,
		] as const)
		.default(DEFAULTS.GEMINI_MODEL)
		.describe('Gemini embedding model'),

	/** Custom dimensions for embedding models */
	dimensions: z
		.number()
		.int()
		.positive()
		.max(3072)
		.optional()
		.describe('Custom embedding dimensions (768, 1536, or 3072)'),

	/** Base URL override */
	baseUrl: z.string().url().default(DEFAULTS.GEMINI_BASE_URL).describe('Gemini API base URL'),
}).strict();

export type GeminiEmbeddingConfig = z.infer<typeof GeminiEmbeddingSchema>;

/**
 * Ollama Embedding Configuration Schema
 *
 * Configuration for local Ollama embedding services.
 * Supports various open-source embedding models.
 *
 * @example
 * ```typescript
 * const config: OllamaEmbeddingConfig = {
 *   type: 'ollama',
 *   model: 'nomic-embed-text',
 *   baseUrl: 'http://localhost:11434/api'
 * };
 * ```
 */
const OllamaEmbeddingSchema = BaseEmbeddingSchema.extend({
	type: z.literal(PROVIDER_TYPES.OLLAMA),

	/** Ollama embedding model */
	model: z
		.enum([
			OLLAMA_MODELS.NOMIC_EMBED_TEXT,
			OLLAMA_MODELS.ALL_MINILM,
			OLLAMA_MODELS.MXBAI_EMBED_LARGE,
		] as const)
		.default(DEFAULTS.OLLAMA_MODEL)
		.describe('Ollama embedding model'),

	/** Custom dimensions if supported by the model */
	dimensions: z
		.number()
		.int()
		.positive()
		.max(3072)
		.optional()
		.describe('Custom embedding dimensions (if supported by the model)'),

	/** Base URL override */
	baseUrl: z.string().url().default(DEFAULTS.OLLAMA_BASE_URL).describe('Ollama API base URL'),

	/** API key not required for local Ollama */
	apiKey: z.string().optional().describe('API key (not required for local Ollama)'),
}).strict();

export type OllamaEmbeddingConfig = z.infer<typeof OllamaEmbeddingSchema>;

/**
 * Backend Configuration Union Schema
 *
 * Discriminated union of all supported embedding provider configurations.
 * Uses the 'type' field to determine which configuration schema to apply.
 */
const BackendConfigSchema = z
	.discriminatedUnion(
		'type',
		[OpenAIEmbeddingSchema, GeminiEmbeddingSchema, OllamaEmbeddingSchema],
		{
			errorMap: (issue, ctx) => {
				if (issue.code === z.ZodIssueCode.invalid_union_discriminator) {
					return {
						message: `Invalid embedding provider type. Expected: ${Object.values(PROVIDER_TYPES).join(', ')}.`,
					};
				}
				return { message: ctx.defaultError };
			},
		}
	)
	.describe('Backend configuration for embedding system')
	.superRefine((data, ctx) => {
		// Validate OpenAI-specific requirements
		if (data.type === PROVIDER_TYPES.OPENAI) {
			// Check if dimensions are specified for models that support it
			if (data.dimensions) {
				const supportsCustomDimensions =
					data.model === OPENAI_MODELS.TEXT_EMBEDDING_3_SMALL ||
					data.model === OPENAI_MODELS.TEXT_EMBEDDING_3_LARGE;

				if (!supportsCustomDimensions) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `Custom dimensions are only supported for embedding-3 models`,
						path: ['dimensions'],
					});
				}

				// Validate dimension range for specific models
				if (data.model === OPENAI_MODELS.TEXT_EMBEDDING_3_SMALL && data.dimensions > 1536) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `text-embedding-3-small supports max 1536 dimensions`,
						path: ['dimensions'],
					});
				}
			}
		}

		// Validate Gemini-specific requirements
		if (data.type === PROVIDER_TYPES.GEMINI) {
			if (data.dimensions) {
				// Gemini supports 768, 1536, or 3072 dimensions
				if (![768, 1536, 3072].includes(data.dimensions)) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `Gemini models support dimensions: 768, 1536, or 3072`,
						path: ['dimensions'],
					});
				}
			}
		}

		// Validate API key format (basic checks)
		if (data.apiKey) {
			if (data.type === PROVIDER_TYPES.OPENAI && !data.apiKey.startsWith('sk-')) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'OpenAI API key should start with "sk-"',
					path: ['apiKey'],
				});
			}
		}

		// Validate that API key is provided for remote providers
		if ([PROVIDER_TYPES.OPENAI, PROVIDER_TYPES.GEMINI].includes(data.type as any) && !data.apiKey) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `API key is required for ${data.type} provider`,
				path: ['apiKey'],
			});
		}
	});

export type BackendConfig = z.infer<typeof BackendConfigSchema>;

/**
 * Embedding System Configuration Schema
 *
 * Top-level configuration for the embedding system.
 * Uses a single backend configuration.
 */
export const EmbeddingConfigSchema = BackendConfigSchema;

export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;

/**
 * Environment-based Configuration Schema
 *
 * Allows configuration to be loaded from environment variables.
 * Useful for deployment scenarios where config is provided via env vars.
 */
export const EmbeddingEnvConfigSchema = z.object({
	/** Provider type from environment */
	type: z
		.enum([PROVIDER_TYPES.OPENAI, PROVIDER_TYPES.GEMINI, PROVIDER_TYPES.OLLAMA] as const)
		.default(PROVIDER_TYPES.OPENAI)
		.describe('Embedding provider type'),

	/** API key from environment variables */
	apiKey: z.string().optional().describe('API key from environment variables'),

	/** Model from environment */
	model: z.string().optional().describe('Model name from environment'),

	/** Base URL from environment */
	baseUrl: z.string().url().optional().describe('Base URL from environment'),

	/** Dimensions from environment */
	dimensions: z
		.string()
		.transform(val => parseInt(val, 10))
		.pipe(z.number().int().positive())
		.optional()
		.describe('Dimensions from environment (string converted to number)'),

	/** Timeout from environment */
	timeout: z
		.string()
		.transform(val => parseInt(val, 10))
		.pipe(z.number().int().positive())
		.optional()
		.describe('Timeout from environment (string converted to number)'),

	/** Max retries from environment */
	maxRetries: z
		.string()
		.transform(val => parseInt(val, 10))
		.pipe(z.number().int().min(0).max(10))
		.optional()
		.describe('Max retries from environment (string converted to number)'),
});

export type EmbeddingEnvConfig = z.infer<typeof EmbeddingEnvConfigSchema>;


// Input refinement configuration for text-preprocessing, vectorization and retrieval, MY CODE
export const InputRefinementConfigSchema = z
  .object({
    NORMALIZATION_TOLOWERCASE: z
        .boolean()
        .describe('Convert text to lowercase'),
    NORMALIZATION_WHITESPACE: z
        .boolean()
        .describe('Normalize whitespace (trim and collapse multiple spaces)'),
    NORMALIZATION_REMOVEPUNCTUATION: z
        .boolean()
        .describe('Remove punctuation'),
    NORMALIZATION_STOPWORDS: z
        .boolean()
        .describe('Remove common stopwords'),
    NORMALIZATION_STEMMING: z
        .boolean()
        .describe('Apply stemming to words'),
    NORMALIZATION_LEMMATIZATION: z
        .boolean()
        .describe('Apply lemmatization to words'),
    NORMALIZATION_LANGUAGE: z
        .string()
        .describe('Language for language-specific normalization (e.g., en for English)'),
  })
  .strict()
  .describe('Input refinement configuration for text normalization before embedding');

export type InputRefinementConfig = z.infer<typeof InputRefinementConfigSchema>;
/**
 * Parse and validate input refinement configuration
 *
 * @param config - Raw configuration object
 * @returns Validated configuration
 * @throws {z.ZodError} If configuration is invalid
 */
export function parseInputRefinementConfig(config: unknown): InputRefinementConfig {
	return InputRefinementConfigSchema.parse(config);
}

/**
 * Parse and validate embedding configuration
 *
 * @param config - Raw configuration object
 * @returns Validated configuration
 * @throws {z.ZodError} If configuration is invalid
 */
export function parseEmbeddingConfig(config: unknown): EmbeddingConfig {
	return EmbeddingConfigSchema.parse(config);
}

/**
 * Parse embedding configuration from environment variables
 *
 * @param env - Environment variables object (defaults to process.env)
 * @returns Validated configuration or null if required env vars are missing
 */
export function parseEmbeddingConfigFromEnv(
	env: Record<string, string | undefined> = process.env
): EmbeddingConfig | null {
	try {
		// Determine provider type from environment
		let providerType = env[ENV_VARS.EMBEDDING_PROVIDER] as keyof typeof PROVIDER_TYPES;

		// Auto-detect provider based on available API keys if not specified
		if (!providerType) {
			if (env[ENV_VARS.OPENAI_API_KEY]) {
				providerType = 'OPENAI';
			} else if (env[ENV_VARS.GEMINI_API_KEY]) {
				providerType = 'GEMINI';
			} else if (env[ENV_VARS.OLLAMA_BASE_URL]) {
				providerType = 'OLLAMA';
			} else {
				// No supported provider found
				return null;
			}
		}

		const rawConfig: any = {
			type: PROVIDER_TYPES[providerType],
		};

		// Add provider-specific configuration
		switch (PROVIDER_TYPES[providerType]) {
			case PROVIDER_TYPES.OPENAI:
				if (env[ENV_VARS.OPENAI_API_KEY]) {
					rawConfig.apiKey = env[ENV_VARS.OPENAI_API_KEY];
				} else {
					return null;
				}
				if (env[ENV_VARS.OPENAI_BASE_URL]) {
					rawConfig.baseUrl = env[ENV_VARS.OPENAI_BASE_URL];
				}
				if (env[ENV_VARS.OPENAI_ORG_ID]) {
					rawConfig.organization = env[ENV_VARS.OPENAI_ORG_ID];
				}
				break;

			case PROVIDER_TYPES.GEMINI:
				if (env[ENV_VARS.GEMINI_API_KEY]) {
					rawConfig.apiKey = env[ENV_VARS.GEMINI_API_KEY];
				} else {
					return null;
				}
				if (env[ENV_VARS.GEMINI_BASE_URL]) {
					rawConfig.baseUrl = env[ENV_VARS.GEMINI_BASE_URL];
				}
				break;

			case PROVIDER_TYPES.OLLAMA:
				// API key is optional for Ollama
				if (env[ENV_VARS.OLLAMA_BASE_URL]) {
					rawConfig.baseUrl = env[ENV_VARS.OLLAMA_BASE_URL];
				}
				break;

			default:
				return null;
		}

		// Add common configuration
		if (env[ENV_VARS.EMBEDDING_MODEL]) {
			rawConfig.model = env[ENV_VARS.EMBEDDING_MODEL];
		}

		if (env[ENV_VARS.EMBEDDING_DIMENSIONS]) {
			rawConfig.dimensions = parseInt(env[ENV_VARS.EMBEDDING_DIMENSIONS] || '1536', 10);
		}

		if (env[ENV_VARS.EMBEDDING_TIMEOUT]) {
			rawConfig.timeout = parseInt(env[ENV_VARS.EMBEDDING_TIMEOUT] ?? '30000', 10);
		}

		if (env[ENV_VARS.EMBEDDING_MAX_RETRIES]) {
			rawConfig.maxRetries = parseInt(env[ENV_VARS.EMBEDDING_MAX_RETRIES] ?? '3', 10);
		}

		return parseEmbeddingConfig(rawConfig);
	} catch {
		// Configuration parsing failed
		return null;
	}
}

/**
 * Validate embedding configuration without throwing
 *
 * @param config - Raw configuration object
 * @returns Validation result with success flag and data/errors
 */
export function validateEmbeddingConfig(config: unknown): {
	success: boolean;
	data?: EmbeddingConfig;
	errors?: z.ZodError;
} {
	try {
		const data = parseEmbeddingConfig(config);
		return { success: true, data };
	} catch (error) {
		if (error instanceof z.ZodError) {
			return { success: false, errors: error };
		}
		return { success: false, errors: error as z.ZodError };
	}
}
