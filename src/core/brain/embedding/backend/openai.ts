/**
 * OpenAI Embedding Backend
 *
 * Implementation of the Embedder interface for OpenAI's embedding services.
 * Supports all OpenAI embedding models with batch processing, retry logic,
 * and comprehensive error handling.
 *
 * @module embedding/backend/openai
 */

import OpenAI from 'openai';
import { logger } from '../../../logger/index.js';
import {
	Embedder,
	OpenAIEmbeddingConfig,
	EmbeddingConnectionError,
	EmbeddingRateLimitError,
	EmbeddingQuotaError,
	EmbeddingValidationError,
	EmbeddingError,
	EmbeddingDimensionError,
} from './types.js';
import {
	MODEL_DIMENSIONS,
	VALIDATION_LIMITS,
	ERROR_MESSAGES,
	LOG_PREFIXES,
	RETRY_CONFIG,
	HTTP_STATUS,
} from '../constants.js';
import { 
	normalizeTextForRetrieval,
} from '../utils.js';
import { InputRefinementConfig } from '../config.js';

/**
 * OpenAI Embedder Implementation
 *
 * Provides embedding functionality using OpenAI's embedding API.
 * Implements comprehensive error handling, retry logic, and batch processing.
 */
export class OpenAIEmbedder implements Embedder {
	private openai: OpenAI;
	private readonly config: OpenAIEmbeddingConfig;
	private readonly model: string;
	private readonly dimension: number;
	private readonly refinementConfig?: InputRefinementConfig;

	constructor(config: OpenAIEmbeddingConfig, refinementConfig?: InputRefinementConfig) {
		this.config = config;
		this.model = config.model || 'text-embedding-3-small';
		this.refinementConfig = refinementConfig;

		// Initialize OpenAI client
		this.openai = new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseUrl,
			organization: config.organization,
			timeout: config.timeout,
			maxRetries: config.maxRetries,
		});

		// Set dimension based on model and config
		this.dimension =
			config.dimensions || MODEL_DIMENSIONS[this.model as keyof typeof MODEL_DIMENSIONS] || 1536;

		logger.debug(`${LOG_PREFIXES.OPENAI} Initialized OpenAI embedder`, {
			model: this.model,
			dimension: this.dimension,
			baseUrl: config.baseUrl,
			hasOrganization: !!config.organization,
		});
	}

	// Embedding function, apply input refinement to this part, MY CODE
	async embed(text: string): Promise<number[]> {
		console.log(`Embedding text: ${text}!`);
		logger.silly(`${LOG_PREFIXES.OPENAI} Embedding single text`, {
			textLength: text.length,
			model: this.model,
		});

		// Use refinement config if provided, MY CODE
		if (this.refinementConfig) {
			console.log(`Input refinement enabled. Normalizing input...`);
			text = normalizeTextForRetrieval(text, this.refinementConfig);
		}

		// Validate input
		this.validateInput(text);
		
		const startTime = Date.now();

		try {
			const params: { model: string; input: string; dimensions?: number } = {
				model: this.model,
				input: text,
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
				throw new EmbeddingError('OpenAI API did not return a valid embedding', 'openai');
			}
			const embedding = response.data[0].embedding;
			this.validateEmbeddingDimension(embedding);
			return embedding;
		} catch (error) {
			const processingTime = Date.now() - startTime;
			logger.error(`${LOG_PREFIXES.OPENAI} Failed to create embedding`, {
				error: error instanceof Error ? error.message : String(error),
				model: this.model,
				processingTime,
				textLength: text.length,
			});

			throw this.handleApiError(error);
		}
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		logger.debug(`${LOG_PREFIXES.BATCH} Embedding batch of texts`, {
			count: texts.length,
			model: this.model,
		});

		// Add refinement config if provided, MY CODE
		if (this.refinementConfig) {
			console.log(`Input refinement enabled. Normalizing input...`);
			texts = texts.map(text => normalizeTextForRetrieval(text, this.refinementConfig));
		}

		// Validate batch input
		this.validateBatchInput(texts);

		const startTime = Date.now();

		try {
			const batchParams: { model: string; input: string[]; dimensions?: number } = {
				model: this.model,
				input: texts,
			};
			if (this.config.dimensions !== undefined) {
				batchParams.dimensions = this.config.dimensions;
			}
			const response = await this.createEmbeddingWithRetry(batchParams);
			const embeddings = response.data.map(item => item.embedding);
			embeddings.forEach(this.validateEmbeddingDimension.bind(this));
			return embeddings;
		} catch (error) {
			const processingTime = Date.now() - startTime;
			logger.error(`${LOG_PREFIXES.BATCH} Failed to create batch embeddings`, {
				error: error instanceof Error ? error.message : String(error),
				model: this.model,
				processingTime,
				count: texts.length,
			});

			throw this.handleApiError(error);
		}
	}

	getDimension(): number {
		return this.dimension;
	}

	getConfig(): OpenAIEmbeddingConfig {
		return { ...this.config };
	}

	async isHealthy(): Promise<boolean> {
		try {
			logger.silly(`${LOG_PREFIXES.HEALTH} Checking OpenAI embedder health`);

			// Try a simple embedding request with minimal text
			await this.embed('test');

			logger.debug(`${LOG_PREFIXES.HEALTH} OpenAI embedder is healthy`);
			return true;
		} catch (error) {
			logger.warn(`${LOG_PREFIXES.HEALTH} OpenAI embedder health check failed`, {
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	}

	async disconnect(): Promise<void> {
		logger.debug(`${LOG_PREFIXES.OPENAI} Disconnecting OpenAI embedder`);
		// OpenAI client doesn't require explicit cleanup
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
		let delay: number = RETRY_CONFIG.INITIAL_DELAY;

		for (let attempt = 0; attempt <= this.config.maxRetries!; attempt++) {
			try {
				if (attempt > 0) {
					logger.debug(`${LOG_PREFIXES.OPENAI} Retrying embedding request`, {
						attempt,
						delay,
						maxRetries: this.config.maxRetries,
					});

					// Wait before retry
					await new Promise(resolve => setTimeout(resolve, delay));

					// Calculate next delay with exponential backoff and jitter
					delay = Math.min(delay * RETRY_CONFIG.BACKOFF_MULTIPLIER, RETRY_CONFIG.MAX_DELAY);

					// Add jitter to avoid thundering herd
					const jitter = delay * RETRY_CONFIG.JITTER_FACTOR * Math.random();
					delay = Math.floor(delay + jitter);
				}

				const response = await this.openai.embeddings.create(params);

				if (attempt > 0) {
					logger.info(`${LOG_PREFIXES.OPENAI} Embedding request succeeded after retry`, {
						attempt,
						model: params.model,
					});
				}

				return response;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				// Check if we should retry based on error type
				if (!this.shouldRetry(error, attempt)) {
					break;
				}

				logger.warn(`${LOG_PREFIXES.OPENAI} Embedding request failed, will retry`, {
					attempt: attempt + 1,
					maxRetries: this.config.maxRetries,
					error: lastError.message,
					nextDelay: delay,
				});
			}
		}

		// All retries exhausted
		throw lastError || new EmbeddingError('Unknown error during embedding request', 'openai');
	}

	/**
	 * Determine if an error is retryable
	 */
	private shouldRetry(error: unknown, attempt: number): boolean {
		if (attempt >= this.config.maxRetries!) {
			return false;
		}

		// Handle OpenAI API errors
		if (error && typeof error === 'object' && 'status' in error) {
			const status = (error as any).status;

			// Retry on server errors and rate limits
			return [
				HTTP_STATUS.TOO_MANY_REQUESTS,
				HTTP_STATUS.INTERNAL_SERVER_ERROR,
				HTTP_STATUS.SERVICE_UNAVAILABLE,
			].includes(status);
		}

		// Retry on network errors
		if (error instanceof Error) {
			const message = error.message.toLowerCase();
			return (
				message.includes('network') ||
				message.includes('timeout') ||
				message.includes('connection') ||
				message.includes('econnreset') ||
				message.includes('enotfound')
			);
		}

		return false;
	}

	/**
	 * Handle and categorize API errors
	 */
	private handleApiError(error: unknown): EmbeddingError {
		if (error && typeof error === 'object' && 'status' in error) {
			const apiError = error as any;
			const status = apiError.status;
			const message = apiError.message || String(error);

			switch (status) {
				case HTTP_STATUS.UNAUTHORIZED:
					return new EmbeddingConnectionError(
						ERROR_MESSAGES.INVALID_API_KEY('OpenAI'),
						'openai',
						apiError
					);

				case HTTP_STATUS.TOO_MANY_REQUESTS: {
					const retryAfter = apiError.headers?.['retry-after'];
					return new EmbeddingRateLimitError(
						ERROR_MESSAGES.RATE_LIMIT_EXCEEDED,
						retryAfter ? parseInt(retryAfter, 10) : undefined,
						'openai',
						apiError
					);
				}

				case HTTP_STATUS.FORBIDDEN:
					return new EmbeddingQuotaError(ERROR_MESSAGES.QUOTA_EXCEEDED, 'openai', apiError);

				case HTTP_STATUS.BAD_REQUEST:
					return new EmbeddingValidationError(message, 'openai', apiError);

				default:
					return new EmbeddingConnectionError(
						ERROR_MESSAGES.CONNECTION_FAILED('OpenAI'),
						'openai',
						apiError
					);
			}
		}

		// Handle network and other errors
		if (error instanceof Error) {
			return new EmbeddingConnectionError(error.message, 'openai', error);
		}

		return new EmbeddingError(String(error), 'openai');
	}

	/**
	 * Validate single text input
	 */
	private validateInput(text: string): void {
		if (!text || text.length < VALIDATION_LIMITS.MIN_TEXT_LENGTH) {
			throw new EmbeddingValidationError(ERROR_MESSAGES.EMPTY_TEXT, 'openai');
		}

		if (text.length > VALIDATION_LIMITS.MAX_TEXT_LENGTH) {
			throw new EmbeddingValidationError(
				ERROR_MESSAGES.TEXT_TOO_LONG(text.length, VALIDATION_LIMITS.MAX_TEXT_LENGTH),
				'openai'
			);
		}
	}

	/**
	 * Validate batch input
	 */
	private validateBatchInput(texts: string[]): void {
		if (!Array.isArray(texts) || texts.length === 0) {
			throw new EmbeddingValidationError('Batch input must be a non-empty array', 'openai');
		}

		if (texts.length > VALIDATION_LIMITS.MAX_BATCH_SIZE) {
			throw new EmbeddingValidationError(
				ERROR_MESSAGES.BATCH_TOO_LARGE(texts.length, VALIDATION_LIMITS.MAX_BATCH_SIZE),
				'openai'
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
						'openai',
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
				ERROR_MESSAGES.DIMENSION_MISMATCH(this.dimension, embedding.length),
				this.dimension,
				embedding.length,
				'openai'
			);
		}
	}
}
