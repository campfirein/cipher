/**
 * Embedding Factory Module
 *
 * Factory functions for creating embedding instances with proper validation,
 * error handling, and type safety. Supports multiple providers and
 * configuration methods.
 *
 * @module embedding/factory
 */

import { logger } from '../../logger/index.js';
import {
	parseEmbeddingConfigFromEnv,
	validateEmbeddingConfig,
	type OpenAIEmbeddingConfig as ZodOpenAIEmbeddingConfig,
	type GeminiEmbeddingConfig as ZodGeminiEmbeddingConfig,
	type OllamaEmbeddingConfig as ZodOllamaEmbeddingConfig,
	InputRefinementConfig,
} from './config.js';
import {
	type Embedder,
	type OpenAIEmbeddingConfig as InterfaceOpenAIEmbeddingConfig,
	type GeminiEmbeddingConfig as InterfaceGeminiEmbeddingConfig,
	type OllamaEmbeddingConfig as InterfaceOllamaEmbeddingConfig,
	EmbeddingError,
	EmbeddingValidationError,
	OpenAIEmbedder,
	GeminiEmbedder,
	OllamaEmbedder,
} from './backend/index.js';
import { PROVIDER_TYPES, ERROR_MESSAGES, LOG_PREFIXES, DEFAULTS } from './constants.js';

// Import the backend config type from types
import { type BackendConfig as TypesBackendConfig } from './backend/types.js';

// Use Zod-inferred types for validation, but convert to interface types for backend
export type BackendConfig =
	| ZodOpenAIEmbeddingConfig
	| ZodGeminiEmbeddingConfig
	| ZodOllamaEmbeddingConfig;

/**
 * Embedding factory interface
 *
 * Defines the contract for embedding factory implementations.
 * Each provider should implement this interface.
 */
export interface EmbeddingFactory {
	/**
	 * Create an embedder instance
	 *
	 * @param config - Provider-specific configuration
	 * @returns Promise resolving to embedder instance
	 */
	createEmbedder(config: BackendConfig): Promise<Embedder>;

	/**
	 * Validate configuration for this provider
	 *
	 * @param config - Configuration to validate
	 * @returns True if configuration is valid
	 */
	validateConfig(config: unknown): boolean;

	/**
	 * Get the provider type this factory supports
	 *
	 * @returns Provider type string
	 */
	getProviderType(): string;
}

/**
 * Convert Zod config to interface config for backend compatibility
 */
function convertToInterfaceConfig(config: BackendConfig): any {
	switch (config.type) {
		case PROVIDER_TYPES.OPENAI:
			return {
				type: PROVIDER_TYPES.OPENAI,
				apiKey: config.apiKey,
				model: config.model,
				baseUrl: config.baseUrl,
				timeout: config.timeout,
				maxRetries: config.maxRetries,
				options: config.options,
				organization: (config as ZodOpenAIEmbeddingConfig).organization,
				dimensions: config.dimensions,
			} as InterfaceOpenAIEmbeddingConfig;

		case PROVIDER_TYPES.GEMINI:
			return {
				type: PROVIDER_TYPES.GEMINI,
				apiKey: config.apiKey,
				model: config.model,
				baseUrl: config.baseUrl,
				timeout: config.timeout,
				maxRetries: config.maxRetries,
				options: config.options,
				dimensions: config.dimensions,
			} as InterfaceGeminiEmbeddingConfig;

		case PROVIDER_TYPES.OLLAMA:
			return {
				type: PROVIDER_TYPES.OLLAMA,
				apiKey: config.apiKey,
				model: config.model,
				baseUrl: config.baseUrl,
				timeout: config.timeout,
				maxRetries: config.maxRetries,
				options: config.options,
				dimensions: config.dimensions,
			} as InterfaceOllamaEmbeddingConfig;

		default:
			throw new Error(`Unsupported provider type: ${(config as any).type}`);
	}
}

/**
 * OpenAI Embedding Factory
 *
 * Factory implementation for creating OpenAI embedding instances.
 */
class OpenAIEmbeddingFactory implements EmbeddingFactory {
	async createEmbedder(config: BackendConfig): Promise<Embedder> {
		logger.debug(`${LOG_PREFIXES.FACTORY} Creating OpenAI embedder`, {
			model: config.model,
			baseUrl: config.baseUrl,
			hasOrganization: !!(config as any).organization,
		});

		try {
			// Convert Zod config to interface config for backend compatibility
			const interfaceConfig = convertToInterfaceConfig(config);
			const embedder = new OpenAIEmbedder(interfaceConfig);

			// Test the connection
			const isHealthy = await embedder.isHealthy();
			if (!isHealthy) {
				throw new EmbeddingError(ERROR_MESSAGES.CONNECTION_FAILED('OpenAI'), 'openai');
			}

			logger.info(`${LOG_PREFIXES.FACTORY} Successfully created OpenAI embedder`, {
				model: config.model,
				dimension: embedder.getDimension(),
			});

			return embedder;
		} catch (error) {
			logger.error(`${LOG_PREFIXES.FACTORY} Failed to create OpenAI embedder`, {
				error: error instanceof Error ? error.message : String(error),
				model: config.model,
			});

			if (error instanceof EmbeddingError) {
				throw error;
			}

			throw new EmbeddingError(
				`Failed to create OpenAI embedder: ${error instanceof Error ? error.message : String(error)}`,
				'openai',
				error instanceof Error ? error : undefined
			);
		}
	}

	validateConfig(config: unknown): boolean {
		try {
			const validationResult = validateEmbeddingConfig(config);
			return validationResult.success && validationResult.data?.type === PROVIDER_TYPES.OPENAI;
		} catch {
			return false;
		}
	}

	getProviderType(): string {
		return PROVIDER_TYPES.OPENAI;
	}
}

/**
 * Gemini Embedding Factory
 *
 * Factory implementation for creating Gemini embedding instances.
 */
class GeminiEmbeddingFactory implements EmbeddingFactory {
	async createEmbedder(config: BackendConfig): Promise<Embedder> {
		logger.debug(`${LOG_PREFIXES.FACTORY} Creating Gemini embedder`, {
			model: config.model,
			baseUrl: config.baseUrl,
		});

		try {
			// Convert Zod config to interface config for backend compatibility
			const interfaceConfig = convertToInterfaceConfig(config);
			const embedder = new GeminiEmbedder(interfaceConfig);

			// Test the connection
			const isHealthy = await embedder.isHealthy();
			if (!isHealthy) {
				throw new EmbeddingError(ERROR_MESSAGES.CONNECTION_FAILED('Gemini'), 'gemini');
			}

			logger.info(`${LOG_PREFIXES.FACTORY} Successfully created Gemini embedder`, {
				model: config.model,
				dimension: embedder.getDimension(),
			});

			return embedder;
		} catch (error) {
			logger.error(`${LOG_PREFIXES.FACTORY} Failed to create Gemini embedder`, {
				error: error instanceof Error ? error.message : String(error),
				model: config.model,
			});

			if (error instanceof EmbeddingError) {
				throw error;
			}

			throw new EmbeddingError(
				`Failed to create Gemini embedder: ${error instanceof Error ? error.message : String(error)}`,
				'gemini',
				error instanceof Error ? error : undefined
			);
		}
	}

	validateConfig(config: unknown): boolean {
		try {
			const validationResult = validateEmbeddingConfig(config);
			return validationResult.success && validationResult.data?.type === PROVIDER_TYPES.GEMINI;
		} catch {
			return false;
		}
	}

	getProviderType(): string {
		return PROVIDER_TYPES.GEMINI;
	}
}

/**
 * Ollama Embedding Factory
 *
 * Factory implementation for creating Ollama embedding instances.
 * Supports various local open-source embedding models.
 */
class OllamaEmbeddingFactory implements EmbeddingFactory {
	async createEmbedder(config: BackendConfig): Promise<Embedder> {
		logger.debug(`${LOG_PREFIXES.FACTORY} Creating Ollama embedder`, {
			model: config.model,
			baseUrl: config.baseUrl,
		});

		try {
			// Convert Zod config to interface config for backend compatibility
			const interfaceConfig = convertToInterfaceConfig(config);
			const embedder = new OllamaEmbedder(interfaceConfig);

			// Test the connection
			const isHealthy = await embedder.isHealthy();
			if (!isHealthy) {
				throw new EmbeddingError(ERROR_MESSAGES.CONNECTION_FAILED('Ollama'), 'ollama');
			}

			logger.info(`${LOG_PREFIXES.FACTORY} Successfully created Ollama embedder`, {
				model: config.model,
				dimension: embedder.getDimension(),
			});

			return embedder;
		} catch (error) {
			logger.error(`${LOG_PREFIXES.FACTORY} Failed to create Ollama embedder`, {
				error: error instanceof Error ? error.message : String(error),
				model: config.model,
			});

			if (error instanceof EmbeddingError) {
				throw error;
			}

			throw new EmbeddingError(
				`Failed to create Ollama embedder: ${error instanceof Error ? error.message : String(error)}`,
				'ollama',
				error instanceof Error ? error : undefined
			);
		}
	}

	validateConfig(config: unknown): boolean {
		try {
			const validationResult = validateEmbeddingConfig(config);
			return validationResult.success && validationResult.data?.type === PROVIDER_TYPES.OLLAMA;
		} catch {
			return false;
		}
	}

	getProviderType(): string {
		return PROVIDER_TYPES.OLLAMA;
	}
}

/**
 * Registry of embedding factories
 */
const EMBEDDING_FACTORIES = new Map<string, EmbeddingFactory>([
	[PROVIDER_TYPES.OPENAI, new OpenAIEmbeddingFactory()],
	[PROVIDER_TYPES.GEMINI, new GeminiEmbeddingFactory()],
	[PROVIDER_TYPES.OLLAMA, new OllamaEmbeddingFactory()],
]);

/**
 * Main factory function for creating embedding instances
 *
 * @param config - Embedding configuration
 * @returns Promise resolving to embedder instance
 * @throws {EmbeddingValidationError} If configuration is invalid
 * @throws {EmbeddingError} If embedder creation fails
 *
 * @example
 * ```typescript
 * const embedder = await createEmbedder({
 *   type: 'openai',
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'text-embedding-3-small'
 * });
 * ```
 */
export async function createEmbedder(config: BackendConfig, refinementConfig?: InputRefinementConfig): Promise<Embedder> {
	logger.debug(`${LOG_PREFIXES.FACTORY} Creating embedder`, {
		type: config.type,
	});

	// Validate configuration
	const validationResult = validateEmbeddingConfig(config);
	if (!validationResult.success) {
		const errorMessage =
			validationResult.errors?.issues
				.map(issue => `${issue.path.join('.')}: ${issue.message}`)
				.join(', ') || 'Invalid configuration';

		logger.error(`${LOG_PREFIXES.FACTORY} Configuration validation failed`, {
			type: config.type,
			errors: errorMessage,
		});

		throw new EmbeddingValidationError(`Configuration validation failed: ${errorMessage}`);
	}

	// Get factory for provider type
	const factory = EMBEDDING_FACTORIES.get(config.type);
	if (!factory) {
		logger.error(`${LOG_PREFIXES.FACTORY} Unsupported provider type`, {
			type: config.type,
			supportedTypes: Array.from(EMBEDDING_FACTORIES.keys()),
		});

		throw new EmbeddingValidationError(ERROR_MESSAGES.PROVIDER_NOT_SUPPORTED(config.type));
	}

	// Create embedder instance
	return await factory.createEmbedder(config);
}

/**
 * Create OpenAI embedder with simplified configuration
 *
 * @param config - OpenAI-specific configuration
 * @returns Promise resolving to OpenAI embedder instance
 *
 * @example
 * ```typescript
 * const embedder = await createOpenAIEmbedder({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'text-embedding-3-small'
 * });
 * ```
 */
export async function createOpenAIEmbedder(
	config: Omit<ZodOpenAIEmbeddingConfig, 'type'>
): Promise<Embedder> {
	const openaiConfig: ZodOpenAIEmbeddingConfig = {
		type: PROVIDER_TYPES.OPENAI,
		apiKey: config.apiKey || '',
		model: config.model || DEFAULTS.OPENAI_MODEL,
		baseUrl: config.baseUrl || DEFAULTS.OPENAI_BASE_URL,
		timeout: config.timeout || DEFAULTS.TIMEOUT,
		maxRetries: config.maxRetries || DEFAULTS.MAX_RETRIES,
		...((config as any).organization && { organization: (config as any).organization }),
		...(config.dimensions && { dimensions: config.dimensions }),
		...(config.options && { options: config.options }),
	};
	return createEmbedder(openaiConfig);
}

/**
 * Create Gemini embedder with simplified configuration
 *
 * @param config - Gemini-specific configuration
 * @returns Promise resolving to Gemini embedder instance
 *
 * @example
 * ```typescript
 * const embedder = await createGeminiEmbedder({
 *   apiKey: process.env.GEMINI_API_KEY,
 *   model: 'text-embedding-004'
 * });
 * ```
 */
export async function createGeminiEmbedder(
	config: Omit<ZodGeminiEmbeddingConfig, 'type'>
): Promise<Embedder> {
	const geminiConfig: ZodGeminiEmbeddingConfig = {
		type: PROVIDER_TYPES.GEMINI,
		apiKey: config.apiKey || '',
		model: config.model || DEFAULTS.GEMINI_MODEL,
		baseUrl: config.baseUrl || DEFAULTS.GEMINI_BASE_URL,
		timeout: config.timeout || DEFAULTS.TIMEOUT,
		maxRetries: config.maxRetries || DEFAULTS.MAX_RETRIES,
		...(config.dimensions && { dimensions: config.dimensions }),
		...(config.options && { options: config.options }),
	};
	return createEmbedder(geminiConfig);
}

/**
 * Create embedder from environment variables
 *
 * @param env - Environment variables object (defaults to process.env)
 * @returns Promise resolving to embedder instance or null if config unavailable
 *
 * @example
 * ```typescript
 * // Requires OPENAI_API_KEY environment variable
 * const embedder = await createEmbedderFromEnv();
 * if (embedder) {
 *   const embedding = await embedder.embed('Hello world');
 * }
 * ```
 */
export async function createEmbedderFromEnv(
	env: Record<string, string | undefined> = process.env
): Promise<Embedder | null> {
	logger.debug(`${LOG_PREFIXES.FACTORY} Creating embedder from environment variables`);

	const config = parseEmbeddingConfigFromEnv(env);
	if (!config) {
		logger.warn(`${LOG_PREFIXES.FACTORY} No valid embedding configuration found in environment`);
		return null;
	}

	logger.debug(`${LOG_PREFIXES.FACTORY} Found valid embedding configuration in environment`, {
		type: config.type,
		model: config.model,
	});

	return createEmbedder(config as ZodOpenAIEmbeddingConfig);
}

/**
 * Create a default embedder with minimal configuration
 *
 * Tries providers in priority order: Gemini > OpenRouter > OpenAI > Ollama
 * Uses environment variables to determine available providers.
 *
 * @returns Promise resolving to default embedder instance
 * @throws {EmbeddingValidationError} If no API keys are available
 *
 * @example
 * ```typescript
 * // Uses available API keys from environment variables
 * const embedder = await createDefaultEmbedder();
 * ```
 */
export async function createDefaultEmbedder(): Promise<Embedder> {
	logger.debug(`${LOG_PREFIXES.FACTORY} Creating default embedder`);

	// Try OpenAI first (default, reliable)
	if (process.env.OPENAI_API_KEY) {
		const openaiConfig: ZodOpenAIEmbeddingConfig = {
			type: PROVIDER_TYPES.OPENAI,
			apiKey: process.env.OPENAI_API_KEY,
			model: DEFAULTS.OPENAI_MODEL,
			baseUrl: DEFAULTS.OPENAI_BASE_URL,
			timeout: DEFAULTS.TIMEOUT,
			maxRetries: DEFAULTS.MAX_RETRIES,
		};
		return createEmbedder(openaiConfig);
	}

	// Try Gemini second (free alternative)
	if (process.env.GEMINI_API_KEY) {
		const geminiConfig: ZodGeminiEmbeddingConfig = {
			type: PROVIDER_TYPES.GEMINI,
			apiKey: process.env.GEMINI_API_KEY,
			model: DEFAULTS.GEMINI_MODEL,
			baseUrl: DEFAULTS.GEMINI_BASE_URL,
			timeout: DEFAULTS.TIMEOUT,
			maxRetries: DEFAULTS.MAX_RETRIES,
		};
		return createEmbedder(geminiConfig);
	}

	// Try Ollama third (local, free)
	if (process.env.OLLAMA_BASE_URL) {
		try {
			const ollamaConfig: ZodOllamaEmbeddingConfig = {
				type: PROVIDER_TYPES.OLLAMA,
				model: DEFAULTS.OLLAMA_MODEL,
				baseUrl: process.env.OLLAMA_BASE_URL,
				timeout: DEFAULTS.TIMEOUT,
				maxRetries: DEFAULTS.MAX_RETRIES,
			};
			return createEmbedder(ollamaConfig);
		} catch (error) {
			logger.debug(
				`${LOG_PREFIXES.FACTORY} Ollama embeddings failed (${error instanceof Error ? error.message : String(error)}), no more options`
			);
		}
	}

	throw new EmbeddingValidationError(
		'No embedding API keys found. Please set OPENAI_API_KEY, GEMINI_API_KEY, or configure OLLAMA_BASE_URL'
	);
}

/**
 * Check if a factory exists for the given provider type
 *
 * @param providerType - Provider type to check
 * @returns True if factory exists
 */
export function isEmbeddingFactory(providerType: string): boolean {
	return EMBEDDING_FACTORIES.has(providerType);
}

/**
 * Get all supported provider types
 *
 * @returns Array of supported provider type strings
 */
export function getSupportedProviders(): string[] {
	return Array.from(EMBEDDING_FACTORIES.keys());
}

/**
 * Get factory instance for a specific provider type
 *
 * @param providerType - Provider type
 * @returns Factory instance or undefined if not found
 */
export function getEmbeddingFactory(providerType: string): EmbeddingFactory | undefined {
	return EMBEDDING_FACTORIES.get(providerType);
}

/**
 * Register a new embedding factory
 *
 * @param providerType - Provider type
 * @param factory - Factory instance
 */
export function registerEmbeddingFactory(providerType: string, factory: EmbeddingFactory): void {
	logger.debug(`${LOG_PREFIXES.FACTORY} Registering embedding factory`, {
		providerType,
	});

	EMBEDDING_FACTORIES.set(providerType, factory);
}
