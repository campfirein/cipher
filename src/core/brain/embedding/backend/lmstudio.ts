/**
 * LM Studio Embedding Backend
 *
 * Implementation of the Embedder interface for LM Studio's embedding services.
 * Supports LM Studio's OpenAI-compatible embedding API with local models
 * like nomic-embed-text-v1.5 and other BERT-based models in GGUF format.
 *
 * @module embedding/backend/lmstudio
 */

import OpenAI from 'openai';
import { logger } from '../../../logger/index.js';
import {
	Embedder,
	EmbeddingConfig,
	EmbeddingConnectionError,
	EmbeddingRateLimitError,
	EmbeddingValidationError,
	EmbeddingError,
	EmbeddingDimensionError,
} from './types.js';
import { VALIDATION_LIMITS, LOG_PREFIXES, HTTP_STATUS } from '../constants.js';

/**
 * LM Studio-specific embedding configuration
 */
export interface LMStudioEmbeddingConfig extends EmbeddingConfig {
	type: 'lmstudio';
	model?: 'nomic-embed-text-v1.5' | 'text-embedding-nomic-embed-text-v1.5' | string;
	/** Base URL for LM Studio server, defaults to http://localhost:1234/v1 */
	baseUrl?: string;
	/** Custom dimensions if supported by the model */
	dimensions?: number;
}

/**
 * Default dimension mappings for common LM Studio embedding models
 */
const LM_STUDIO_MODEL_DIMENSIONS: Record<string, number> = {
	'nomic-embed-text-v1.5': 768,
	'text-embedding-nomic-embed-text-v1.5': 768,
	'all-minilm': 384,
	'bge-large': 1024,
	'bge-base': 768,
	'bge-small': 384,
} as const;

/**
 * LM Studio Embedder Implementation
 *
 * Provides embedding functionality using LM Studio's local embedding API.
 * Supports OpenAI-compatible endpoints with local BERT models in GGUF format.
 */
export class LMStudioEmbedder implements Embedder {
	private openai: OpenAI;
	private readonly config: LMStudioEmbeddingConfig;
	private readonly model: string;
	private readonly dimension: number;

	constructor(config: LMStudioEmbeddingConfig) {
		this.config = config;
		this.model = config.model || 'nomic-embed-text-v1.5';

		// Initialize OpenAI client pointing to LM Studio
		this.openai = new OpenAI({
			apiKey: 'lm-studio', // LM Studio uses this as a placeholder
			baseURL: config.baseUrl || 'http://localhost:1234/v1',
			timeout: config.timeout || 30000,
			maxRetries: config.maxRetries || 3,
		});

		// Set dimension based on model and config
		this.dimension = config.dimensions || LM_STUDIO_MODEL_DIMENSIONS[this.model] || 768; // Default to 768 for most BERT-based models

		// Reduce retry delays for testing
		this.config.maxRetries = config.maxRetries || 3;
		this.config.timeout = config.timeout || 30000;

		logger.debug(`${LOG_PREFIXES.LMSTUDIO || '[LMSTUDIO]'} Initialized LM Studio embedder`, {
			model: this.model,
			dimension: this.dimension,
			baseUrl: config.baseUrl || 'http://localhost:1234/v1',
		});
	}

	async embed(text: string): Promise<number[]> {
		const { model } = this;
		logger.silly(`${LOG_PREFIXES.LMSTUDIO || '[LMSTUDIO]'} Embedding single text`, {
			textLength: text.length,
			model: this.model,
		});

		// Validate input
		this.validateInput(text);

		const startTime = Date.now();

		try {
			// Clean text by replacing newlines with spaces (LM Studio recommendation)
			const cleanText = text.replace(/\n/g, ' ');

			const params: { model: string; input: string; dimensions?: number } = {
				model: this.model,
				input: cleanText,
			};

			if (this.config.dimensions !== undefined) {
				params.dimensions = this.config.dimensions;
			}

			const response = await this.createEmbeddingWithRetry(params);

			if (
				!response.data ||
				!Array.isArray(response.data) ||
				!response.data[0] ||
				!response.data[0].embedding
			) {
				throw new EmbeddingError('LM Studio API did not return a valid embedding', 'lmstudio');
			}

			const embedding = response.data[0].embedding;
			this.validateEmbeddingDimension(embedding);

			const processingTime = Date.now() - startTime;
			logger.debug(`${LOG_PREFIXES.LMSTUDIO || '[LMSTUDIO]'} Successfully created embedding`, {
				model,
				dimension: embedding.length,
				processingTime,
			});

			return embedding;
		} catch (error) {
			const processingTime = Date.now() - startTime;
			logger.error(`${LOG_PREFIXES.LMSTUDIO || '[LMSTUDIO]'} Failed to create embedding`, {
				error: error instanceof Error ? error.message : String(error),
				model: this.model,
				processingTime,
				textLength: text.length,
			});

			// Don't wrap if it's already an EmbeddingError
			if (error instanceof EmbeddingError) {
				throw error;
			}
			throw this.handleApiError(error);
		}
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		const { model } = this;
		logger.debug(`${LOG_PREFIXES.LMSTUDIO || '[LMSTUDIO]'} Embedding batch of texts`, {
			count: texts.length,
			model: this.model,
		});

		// Validate batch input
		this.validateBatchInput(texts);

		const startTime = Date.now();

		try {
			// Clean texts by replacing newlines with spaces
			const cleanTexts = texts.map(text => text.replace(/\n/g, ' '));

			const batchParams: { model: string; input: string[]; dimensions?: number } = {
				model: this.model,
				input: cleanTexts,
			};

			if (this.config.dimensions !== undefined) {
				batchParams.dimensions = this.config.dimensions;
			}

			const response = await this.createEmbeddingWithRetry(batchParams);
			const embeddings = response.data.map(item => item.embedding);

			// Validate all embeddings
			embeddings.forEach(this.validateEmbeddingDimension.bind(this));

			const processingTime = Date.now() - startTime;
			logger.debug(
				`${LOG_PREFIXES.LMSTUDIO || '[LMSTUDIO]'} Successfully created batch embeddings`,
				{
					model,
					count: embeddings.length,
					processingTime,
				}
			);

			return embeddings;
		} catch (error) {
			const processingTime = Date.now() - startTime;
			logger.error(`${LOG_PREFIXES.LMSTUDIO || '[LMSTUDIO]'} Failed to create batch embeddings`, {
				error: error instanceof Error ? error.message : String(error),
				model,
				processingTime,
				count: texts.length,
			});

			// Don't wrap if it's already an EmbeddingError
			if (error instanceof EmbeddingError) {
				throw error;
			}
			throw this.handleApiError(error);
		}
	}

	getDimension(): number {
		return this.dimension;
	}

	getConfig(): LMStudioEmbeddingConfig {
		return { ...this.config };
	}

	async isHealthy(): Promise<boolean> {
		try {
			logger.silly(`${LOG_PREFIXES.LMSTUDIO || '[LMSTUDIO]'} Checking LM Studio embedder health`);

			// Try a simple embedding request with minimal text
			await this.embed('health check');

			logger.debug(`${LOG_PREFIXES.LMSTUDIO || '[LMSTUDIO]'} LM Studio embedder is healthy`);
			return true;
		} catch (error) {
			logger.warn(
				`${LOG_PREFIXES.LMSTUDIO || '[LMSTUDIO]'} LM Studio embedder health check failed`,
				{
					error: error instanceof Error ? error.message : String(error),
					baseUrl: this.config.baseUrl || 'http://localhost:1234/v1',
				}
			);
			return false;
		}
	}

	async disconnect(): Promise<void> {
		logger.debug(`${LOG_PREFIXES.LMSTUDIO || '[LMSTUDIO]'} Disconnecting LM Studio embedder`);
		// LM Studio client doesn't require explicit cleanup
		// This is here for interface compliance and future extensibility
	}

	/**
	 * Create embedding with retry logic
	 */
	private async createEmbeddingWithRetry(params: {
		model: string;
		input: string | string[];
		dimensions?: number;
	}): Promise<OpenAI.Embeddings.CreateEmbeddingResponse> {
		let lastError: Error | undefined;
		let delay: number = 100; // Shorter delay for testing

		for (let attempt = 0; attempt <= this.config.maxRetries!; attempt++) {
			try {
				if (attempt > 0) {
					logger.debug(`${LOG_PREFIXES.LMSTUDIO || '[LMSTUDIO]'} Retrying embedding request`, {
						attempt,
						delay,
						maxRetries: this.config.maxRetries,
					});

					// Wait before retry
					await new Promise(resolve => setTimeout(resolve, delay));

					// Calculate next delay with exponential backoff (shorter for testing)
					delay = Math.min(delay * 2, 500); // Max 500ms for testing
				}

				const response = await this.openai.embeddings.create(params);

				if (attempt > 0) {
					logger.info(
						`${LOG_PREFIXES.LMSTUDIO || '[LMSTUDIO]'} Embedding request succeeded after retry`,
						{
							attempt,
							model: params.model,
						}
					);
				}

				return response;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				logger.debug(`Attempt ${attempt + 1} failed with error:`, {
					errorType:
						error && typeof error === 'object' && 'constructor' in error
							? (error as any).constructor.name
							: undefined,
					errorMessage:
						error && typeof error === 'object' && 'message' in error
							? (error as any).message
							: String(error),
					hasStatus: error && typeof error === 'object' && 'status' in error,
					status:
						error && typeof error === 'object' && 'status' in error
							? (error as any).status
							: 'none',
				});

				// Check if we should retry based on error type
				if (!this.shouldRetry(error, attempt)) {
					logger.debug(`Not retrying - error is not retryable`);
					break;
				}

				logger.warn(
					`${LOG_PREFIXES.LMSTUDIO || '[LMSTUDIO]'} Embedding request failed, will retry`,
					{
						attempt: attempt + 1,
						maxRetries: this.config.maxRetries,
						error: lastError.message,
						nextDelay: delay,
					}
				);
			}
		}

		// All retries exhausted
		if (lastError) {
			// Don't wrap the error again if it's already an EmbeddingError
			if (lastError instanceof EmbeddingError) {
				throw lastError;
			}
			throw this.handleApiError(lastError);
		}
		throw new EmbeddingError('Unknown error during embedding request', 'lmstudio');
	}

	/**
	 * Determine if an error is retryable
	 */
	private shouldRetry(error: unknown, attempt: number): boolean {
		if (attempt >= this.config.maxRetries!) {
			return false;
		}

		// Handle OpenAI API errors (LM Studio uses OpenAI-compatible format)
		if (error && typeof error === 'object' && 'status' in error) {
			const status = (error as any).status;

			// Retry on server errors and rate limits
			return [
				HTTP_STATUS.TOO_MANY_REQUESTS,
				HTTP_STATUS.INTERNAL_SERVER_ERROR,
				HTTP_STATUS.SERVICE_UNAVAILABLE,
			].includes(status);
		}

		// Retry on network errors (common with local servers)
		if (error instanceof Error) {
			const message = error.message.toLowerCase();
			return (
				message.includes('network') ||
				message.includes('timeout') ||
				message.includes('connection') ||
				message.includes('econnreset') ||
				message.includes('enotfound') ||
				message.includes('econnrefused') || // Common with local servers
				message.includes('fetch failed')
			);
		}

		return false;
	}

	/**
	 * Handle and categorize API errors
	 */
	private handleApiError(error: unknown): EmbeddingError {
		logger.debug(`handleApiError called with:`, {
			errorType: error?.constructor?.name,
			errorMessage: error instanceof Error ? error.message : String(error),
			hasStatus: error && typeof error === 'object' && 'status' in error,
			status:
				error && typeof error === 'object' && 'status' in error ? (error as any).status : 'none',
			errorKeys: error && typeof error === 'object' ? Object.keys(error as any) : [],
		});

		if (error && typeof error === 'object' && 'status' in error) {
			const apiError = error as any;
			const status = apiError.status;
			const message = apiError.message || String(error);

			logger.debug(`Handling API error with status ${status}: ${message}`);

			switch (status) {
				case HTTP_STATUS.UNAUTHORIZED:
					return new EmbeddingConnectionError(
						'LM Studio server rejected the request. Ensure the embedding model is loaded.',
						'lmstudio',
						apiError
					);

				case HTTP_STATUS.TOO_MANY_REQUESTS:
					return new EmbeddingRateLimitError(
						'LM Studio server is busy. Try again later.',
						undefined,
						'lmstudio',
						apiError
					);

				case HTTP_STATUS.BAD_REQUEST:
					return new EmbeddingValidationError(
						`LM Studio server rejected the request: ${message}`,
						'lmstudio',
						apiError
					);

				case HTTP_STATUS.NOT_FOUND:
					return new EmbeddingConnectionError(
						`LM Studio embedding model '${this.model}' not found. Ensure the model is loaded.`,
						'lmstudio',
						apiError
					);

				default:
					return new EmbeddingConnectionError(
						`LM Studio server error (${status}): ${message}`,
						'lmstudio',
						apiError
					);
			}
		}

		// Handle network and connection errors
		if (error instanceof Error) {
			const message = error.message.toLowerCase();

			if (message.includes('econnrefused') || message.includes('fetch failed')) {
				return new EmbeddingConnectionError(
					'Cannot connect to LM Studio server at ' +
						(this.config.baseUrl || 'http://localhost:1234/v1') +
						'. Ensure LM Studio is running and the embedding model is loaded.',
					'lmstudio',
					error
				);
			}

			return new EmbeddingConnectionError(error.message, 'lmstudio', error);
		}

		return new EmbeddingError(String(error), 'lmstudio');
	}

	/**
	 * Validate single text input
	 */
	private validateInput(text: string): void {
		if (!text || text.length < VALIDATION_LIMITS.MIN_TEXT_LENGTH) {
			throw new EmbeddingValidationError('Text input cannot be empty', 'lmstudio');
		}

		if (text.length > VALIDATION_LIMITS.MAX_TEXT_LENGTH) {
			throw new EmbeddingValidationError(
				`Text too long: ${text.length} characters exceeds limit of ${VALIDATION_LIMITS.MAX_TEXT_LENGTH}`,
				'lmstudio'
			);
		}
	}

	/**
	 * Validate batch input
	 */
	private validateBatchInput(texts: string[]): void {
		if (!Array.isArray(texts) || texts.length === 0) {
			throw new EmbeddingValidationError('Batch input must be a non-empty array', 'lmstudio');
		}

		if (texts.length > VALIDATION_LIMITS.MAX_BATCH_SIZE) {
			throw new EmbeddingValidationError(
				`Batch too large: ${texts.length} items exceeds limit of ${VALIDATION_LIMITS.MAX_BATCH_SIZE}`,
				'lmstudio'
			);
		}

		// Validate each text in the batch
		texts.forEach((text, index) => {
			try {
				this.validateInput(text);
			} catch (error) {
				if (error instanceof EmbeddingValidationError) {
					throw new EmbeddingValidationError(
						`Batch item ${index}: ${error.message}`,
						'lmstudio',
						error
					);
				}
				throw error;
			}
		});
	}

	/**
	 * Validate embedding dimension
	 */
	private validateEmbeddingDimension(embedding: number[]): void {
		if (embedding.length !== this.dimension) {
			throw new EmbeddingDimensionError(
				`Embedding dimension mismatch: expected ${this.dimension}, got ${embedding.length}`,
				this.dimension,
				embedding.length,
				'lmstudio'
			);
		}
	}
}
