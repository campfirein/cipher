/**
 * Embedding Module
 *
 * High-performance text embedding system supporting multiple providers.
 * Provides a unified API for generating embeddings with comprehensive
 * error handling, retry logic, and lifecycle management.
 *
 * Features:
 * - Multiple provider support (OpenAI, future: Anthropic, Gemini, Cohere, etc.)
 * - Batch operations for efficient processing
 * - Type-safe configuration with runtime validation
 * - Comprehensive error handling and retry logic
 * - Health monitoring and statistics collection
 * - Graceful fallback and connection management
 *
 * @module embedding
 *
 * @example
 * ```typescript
 * import { createEmbedder, EmbeddingManager } from './embedding';
 *
 * // Create a single embedder
 * const embedder = await createEmbedder({
 *   type: 'openai',
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'text-embedding-3-small'
 * });
 *
 * // Generate embeddings
 * const embedding = await embedder.embed('Hello world');
 * const embeddings = await embedder.embedBatch(['Hello', 'World']);
 *
 * // Use embedding manager for multiple embedders
 * const manager = new EmbeddingManager();
 * const { embedder: managedEmbedder } = await manager.createEmbedder({
 *   type: 'openai',
 *   apiKey: process.env.OPENAI_API_KEY
 * });
 *
 * // Health monitoring
 * manager.startHealthChecks();
 * const healthResults = await manager.checkAllHealth();
 *
 * // Cleanup
 * await manager.disconnect();
 * ```
 */

// Export types
export type {
	Embedder,
	EmbeddingConfig,
	OpenAIEmbeddingConfig,
	BackendConfig,
	EmbeddingResult,
	BatchEmbeddingResult,
	EmbeddingFactory,
	HealthCheckResult,
	EmbedderInfo,
	EmbeddingStats,
	EmbeddingEnvConfig,
} from './types.js';

// Export error classes
export {
	EmbeddingError,
	EmbeddingConnectionError,
	EmbeddingDimensionError,
	EmbeddingRateLimitError,
	EmbeddingQuotaError,
	EmbeddingValidationError,
} from './types.js';

// Export factory functions
export {
	createEmbedder,
	createOpenAIEmbedder,
	createEmbedderFromEnv,
	createDefaultEmbedder,
	isEmbeddingFactory,
	getSupportedProviders,
	getEmbeddingFactory,
	registerEmbeddingFactory,
} from './factory.js';

// Export manager
export { EmbeddingManager } from './manager.js';

// Export configuration utilities
export {
	parseEmbeddingConfig,
	parseEmbeddingConfigFromEnv,
	validateEmbeddingConfig,
	EmbeddingConfigSchema,
} from './config.js';

// Export constants for external use
export {
	PROVIDER_TYPES,
	OPENAI_MODELS,
	MODEL_DIMENSIONS,
	DEFAULTS,
	VALIDATION_LIMITS,
} from './constants.js';

// Export utilities
export {
	getEmbeddingConfigFromEnv,
	isEmbeddingConfigAvailable,
	getEmbeddingConfigSummary,
	validateEmbeddingEnv,
	analyzeProviderConfiguration,
} from './utils.js';
