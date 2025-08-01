/**
 * Embedding Backend Module
 *
 * Exports all embedding backend types and implementations.
 * Provides a unified interface for different embedding providers.
 *
 * @module embedding/backend
 */

// Export core types
export type {
	Embedder,
	EmbeddingConfig,
	BackendConfig,
	OpenAIEmbeddingConfig,
	GeminiEmbeddingConfig,
	OllamaEmbeddingConfig,
	VoyageEmbeddingConfig,
	QwenEmbeddingConfig,
	AWSBedrockEmbeddingConfig,
	LMStudioEmbeddingConfig,
	EmbeddingResult,
	BatchEmbeddingResult,
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

// Export backend implementations
export { OpenAIEmbedder } from './openai.js';
export { GeminiEmbedder } from './gemini.js';
export { OllamaEmbedder } from './ollama.js';
export { VoyageEmbedder } from './voyage.js';
export { QwenEmbedder } from './qwen.js';
export { AWSBedrockEmbedder } from './aws.js';
export { LMStudioEmbedder } from './lmstudio.js';
