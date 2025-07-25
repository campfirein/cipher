/**
 * Embedding Backend Types and Interfaces
 *
 * Core type definitions for the embedding system backends.
 * Provides the fundamental interfaces that all embedding providers must implement.
 *
 * @module embedding/backend/types
 */

import { InputRefinementConfig } from "../config.js";

/**
 * Core interface for embedding providers
 *
 * All embedding backends must implement this interface to provide
 * consistent embedding functionality across different providers.
 */
export interface Embedder {
	/**
	 * Generate embedding for a single text input
	 *
	 * @param text - The text to embed
	 * @returns Promise resolving to the embedding vector
	 */
	embed(text: string, refinementCfg?: InputRefinementConfig): Promise<number[]>;

	/**
	 * Generate embeddings for multiple text inputs in batch
	 *
	 * @param texts - Array of texts to embed
	 * @returns Promise resolving to array of embedding vectors
	 */
	embedBatch(texts: string[]): Promise<number[][]>;

	/**
	 * Get the dimension of embeddings produced by this embedder
	 *
	 * @returns The vector dimension
	 */
	getDimension(): number;

	/**
	 * Get the configuration used by this embedder
	 *
	 * @returns The embedder configuration
	 */
	getConfig(): EmbeddingConfig;

	/**
	 * Check if the embedder is healthy and can process requests
	 *
	 * @returns Promise resolving to health status
	 */
	isHealthy(): Promise<boolean>;

	/**
	 * Clean up resources and close connections
	 */
	disconnect(): Promise<void>;
}

/**
 * Base configuration interface for all embedding providers
 */
export interface EmbeddingConfig {
	/** The embedding provider type */
	type: string;

	/** API key for the provider */
	apiKey?: string;

	/** Model name to use for embeddings */
	model?: string;

	/** Base URL for the provider API */
	baseUrl?: string;

	/** Request timeout in milliseconds */
	timeout?: number;

	/** Maximum number of retry attempts */
	maxRetries?: number;

	/** Provider-specific options */
	options?: Record<string, any>;
}

/**
 * OpenAI-specific embedding configuration
 */
export interface OpenAIEmbeddingConfig extends EmbeddingConfig {
	type: 'openai';
	model?: 'text-embedding-3-small' | 'text-embedding-3-large' | 'text-embedding-ada-002';
	/** Organization ID for OpenAI API */
	organization?: string;
	/** Custom dimensions for embedding-3 models */
	dimensions?: number;
}

/**
 * Gemini-specific embedding configuration
 */
export interface GeminiEmbeddingConfig extends EmbeddingConfig {
	type: 'gemini';
	model?: 'text-embedding-004' | 'gemini-embedding-001' | 'embedding-001';
	/** Custom dimensions for Gemini models */
	dimensions?: number;
}

/**
 * Ollama-specific embedding configuration
 */
export interface OllamaEmbeddingConfig extends EmbeddingConfig {
	type: 'ollama';
	model?: 'nomic-embed-text' | 'all-minilm' | 'mxbai-embed-large' | string;
	/** Custom dimensions if supported by the model */
	dimensions?: number;
}

/**
 * Union type for all supported backend configurations
 */
export type BackendConfig = OpenAIEmbeddingConfig | GeminiEmbeddingConfig | OllamaEmbeddingConfig;

/**
 * Result from embedding operation with metadata
 */
export interface EmbeddingResult {
	/** The embedding vector */
	embedding: number[];
	/** Metadata about the embedding operation */
	metadata: {
		/** Model used for embedding */
		model: string;
		/** Token count for the input text */
		tokens?: number;
		/** Processing time in milliseconds */
		processingTime?: number;
	};
}

/**
 * Batch embedding result
 */
export interface BatchEmbeddingResult {
	/** Array of embedding vectors */
	embeddings: number[][];
	/** Metadata about the batch operation */
	metadata: {
		/** Model used for embedding */
		model: string;
		/** Total token count for all inputs */
		totalTokens?: number;
		/** Processing time in milliseconds */
		processingTime?: number;
		/** Number of successful embeddings */
		successCount: number;
		/** Number of failed embeddings */
		failureCount: number;
	};
}

/**
 * Base error class for embedding operations
 */
export class EmbeddingError extends Error {
	constructor(
		message: string,
		public readonly provider?: string,
		public override readonly cause?: Error
	) {
		super(message);
		this.name = 'EmbeddingError';
	}
}

/**
 * Error thrown when connection to embedding provider fails
 */
export class EmbeddingConnectionError extends EmbeddingError {
	constructor(message: string, provider?: string, cause?: Error) {
		super(message, provider, cause);
		this.name = 'EmbeddingConnectionError';
	}
}

/**
 * Error thrown when embedding dimensions don't match expected values
 */
export class EmbeddingDimensionError extends EmbeddingError {
	constructor(
		message: string,
		public readonly expected: number,
		public readonly actual: number,
		provider?: string
	) {
		super(message, provider);
		this.name = 'EmbeddingDimensionError';
	}
}

/**
 * Error thrown when API rate limits are exceeded
 */
export class EmbeddingRateLimitError extends EmbeddingError {
	constructor(
		message: string,
		public readonly retryAfter?: number,
		provider?: string,
		cause?: Error
	) {
		super(message, provider, cause);
		this.name = 'EmbeddingRateLimitError';
	}
}

/**
 * Error thrown when API quota is exceeded
 */
export class EmbeddingQuotaError extends EmbeddingError {
	constructor(message: string, provider?: string, cause?: Error) {
		super(message, provider, cause);
		this.name = 'EmbeddingQuotaError';
	}
}

/**
 * Error thrown when input validation fails
 */
export class EmbeddingValidationError extends EmbeddingError {
	constructor(message: string, provider?: string, cause?: Error) {
		super(message, provider, cause);
		this.name = 'EmbeddingValidationError';
	}
}
