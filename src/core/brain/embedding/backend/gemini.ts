/**
 * Gemini Embedding Backend
 *
 * Implementation of the Embedder interface for Google's Gemini embedding models.
 * Supports the latest gemini-embedding-001 model with configurable dimensions.
 *
 * @module embedding/backend/gemini
 */

import { logger } from '../../../logger/index.js';
import {
	type Embedder,
	type GeminiEmbeddingConfig,
	type EmbeddingConfig,
	EmbeddingError,
	EmbeddingConnectionError,
	EmbeddingRateLimitError,
	EmbeddingDimensionError,
	EmbeddingValidationError,
} from './types.js';
import { LOG_PREFIXES, VALIDATION_LIMITS, RETRY_CONFIG, HTTP_STATUS } from '../constants.js';

/**
 * Gemini API response for text embedding
 */
interface GeminiEmbeddingResponse {
	embedding: {
		values: number[];
	};
}

/**
 * Gemini API error response
 */
interface GeminiErrorResponse {
	error: {
		code: number;
		message: string;
		status?: string;
	};
}

/**
 * Gemini Embedder Implementation
 *
 * Provides embedding functionality using Google's Gemini embedding models.
 * Supports configurable dimensions and comprehensive error handling.
 */
export class GeminiEmbedder implements Embedder {
	private readonly config: GeminiEmbeddingConfig;
	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly model: string;
	private readonly dimension: number;
	private readonly timeout: number;
	private readonly maxRetries: number;

	constructor(config: GeminiEmbeddingConfig) {
		this.config = config;
		this.apiKey = config.apiKey || '';
		this.model = config.model || 'gemini-embedding-001';
		this.dimension = config.dimensions || 1536; // Default to 1536 for compatibility
		this.timeout = config.timeout || 30000;
		this.maxRetries = config.maxRetries || 3;
		this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';

		logger.debug(`${LOG_PREFIXES.EMBEDDING} Gemini embedder initialized`, {
			model: this.model,
			dimension: this.dimension,
			baseUrl: this.baseUrl,
		});
	}

	async embed(text: string): Promise<number[]> {
		if (!text || text.trim().length === 0) {
			throw new EmbeddingValidationError('Text cannot be empty');
		}

		if (text.length > VALIDATION_LIMITS.MAX_TEXT_LENGTH) {
			throw new EmbeddingValidationError(
				`Text length ${text.length} exceeds maximum of ${VALIDATION_LIMITS.MAX_TEXT_LENGTH} characters`
			);
		}

		const startTime = Date.now();

		try {
			logger.debug(`${LOG_PREFIXES.EMBEDDING} Starting Gemini embedding`, {
				textLength: text.length,
				model: this.model,
			});

			const response = await this.makeRequest('/models/' + this.model + ':embedContent', {
				content: {
					parts: [{ text }],
				},
				outputDimensionality: this.dimension,
			});

			const embedding = response.embedding.values;
			const processingTime = Date.now() - startTime;

			if (embedding.length !== this.dimension) {
				throw new EmbeddingDimensionError(
					`Expected ${this.dimension} dimensions, got ${embedding.length}`,
					this.dimension,
					embedding.length,
					'gemini'
				);
			}

			logger.debug(`${LOG_PREFIXES.EMBEDDING} Gemini embedding completed`, {
				dimension: embedding.length,
				processingTime,
			});

			return embedding;
		} catch (error) {
			const processingTime = Date.now() - startTime;
			logger.error(`${LOG_PREFIXES.EMBEDDING} Gemini embedding failed`, {
				error: error instanceof Error ? error.message : String(error),
				errorType: error?.constructor?.name,
				stack: error instanceof Error ? error.stack : undefined,
				processingTime,
			});

			if (error instanceof EmbeddingError) {
				throw error;
			}

			throw new EmbeddingError(
				`Gemini embedding failed: ${error instanceof Error ? error.message : String(error)}`,
				'gemini',
				error instanceof Error ? error : undefined
			);
		}
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		if (!texts || texts.length === 0) {
			throw new EmbeddingValidationError('Text array cannot be empty');
		}

		if (texts.length > VALIDATION_LIMITS.MAX_BATCH_SIZE) {
			throw new EmbeddingValidationError(
				`Batch size ${texts.length} exceeds maximum of ${VALIDATION_LIMITS.MAX_BATCH_SIZE}`
			);
		}

		// Validate individual texts
		for (let i = 0; i < texts.length; i++) {
			const text = texts[i];
			if (!text || text.trim().length === 0) {
				throw new EmbeddingValidationError(`Text at index ${i} cannot be empty`);
			}
			if (text.length > VALIDATION_LIMITS.MAX_TEXT_LENGTH) {
				throw new EmbeddingValidationError(
					`Text at index ${i} length ${text.length} exceeds maximum of ${VALIDATION_LIMITS.MAX_TEXT_LENGTH} characters`
				);
			}
		}

		const startTime = Date.now();

		try {
			logger.debug(`${LOG_PREFIXES.EMBEDDING} Starting Gemini batch embedding`, {
				batchSize: texts.length,
				model: this.model,
			});

			// Gemini API doesn't support true batch embedding, so we'll process sequentially
			// In a production implementation, you might want to parallelize with rate limiting
			const embeddings: number[][] = [];

			for (const text of texts) {
				const embedding = await this.embed(text);
				embeddings.push(embedding);
			}

			const processingTime = Date.now() - startTime;

			logger.debug(`${LOG_PREFIXES.EMBEDDING} Gemini batch embedding completed`, {
				batchSize: embeddings.length,
				dimension: embeddings[0]?.length,
				processingTime,
			});

			return embeddings;
		} catch (error) {
			const processingTime = Date.now() - startTime;
			logger.error(`${LOG_PREFIXES.EMBEDDING} Gemini batch embedding failed`, {
				error: error instanceof Error ? error.message : String(error),
				batchSize: texts.length,
				processingTime,
			});

			if (error instanceof EmbeddingError) {
				throw error;
			}

			throw new EmbeddingError(
				`Gemini batch embedding failed: ${error instanceof Error ? error.message : String(error)}`,
				'gemini',
				error instanceof Error ? error : undefined
			);
		}
	}

	async isHealthy(): Promise<boolean> {
		try {
			logger.debug(`${LOG_PREFIXES.HEALTH} Checking Gemini embedder health`);

			// Test with a simple text
			await this.embed('health check');

			logger.debug(`${LOG_PREFIXES.HEALTH} Gemini embedder is healthy`);
			return true;
		} catch (error) {
			logger.warn(`${LOG_PREFIXES.HEALTH} Gemini embedder health check failed`, {
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	}

	getDimension(): number {
		return this.dimension;
	}

	getModel(): string {
		return this.model;
	}

	getProvider(): string {
		return 'gemini';
	}

	getConfig(): EmbeddingConfig {
		return this.config;
	}

	async disconnect(): Promise<void> {
		// Gemini API is stateless, no cleanup needed
		logger.debug(`${LOG_PREFIXES.EMBEDDING} Gemini embedder disconnected`);
	}

	/**
	 * Make authenticated request to Gemini API
	 */
	private async makeRequest(endpoint: string, body: any): Promise<GeminiEmbeddingResponse> {
		const url = `${this.baseUrl}${endpoint}?key=${this.apiKey}`;

		let lastError: Error | undefined;
		let delay: number = RETRY_CONFIG.INITIAL_DELAY;

		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			try {
				logger.silly(`${LOG_PREFIXES.EMBEDDING} Making Gemini API request`, {
					attempt: attempt + 1,
					maxRetries: this.maxRetries + 1,
					endpoint,
				});

				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), this.timeout);

				const response = await globalThis.fetch(url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(body),
					signal: controller.signal,
				});

				clearTimeout(timeoutId);

				if (!response.ok) {
					const errorData = (await response.json().catch(() => ({}))) as GeminiErrorResponse;
					const errorMessage = errorData.error?.message || `HTTP ${response.status}`;

					switch (response.status) {
						case HTTP_STATUS.UNAUTHORIZED:
							throw new EmbeddingError(`Invalid Gemini API key: ${errorMessage}`, 'gemini');
						case HTTP_STATUS.FORBIDDEN:
							throw new EmbeddingError(`Gemini API access forbidden: ${errorMessage}`, 'gemini');
						case HTTP_STATUS.TOO_MANY_REQUESTS:
							throw new EmbeddingRateLimitError(`Gemini API rate limit exceeded: ${errorMessage}`);
						case HTTP_STATUS.BAD_REQUEST:
							throw new EmbeddingValidationError(`Invalid request to Gemini API: ${errorMessage}`);
						default:
							throw new EmbeddingConnectionError(`Gemini API error: ${errorMessage}`);
					}
				}

				const data = (await response.json()) as GeminiEmbeddingResponse;

				if (!data.embedding?.values) {
					throw new EmbeddingError('Invalid response format from Gemini API', 'gemini');
				}

				return data;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				// Don't retry on validation errors or auth errors
				if (error instanceof EmbeddingValidationError || error instanceof EmbeddingError) {
					throw error;
				}

				// If this was the last attempt, throw the error
				if (attempt === this.maxRetries) {
					break;
				}

				// Wait before retrying
				logger.debug(`${LOG_PREFIXES.EMBEDDING} Retrying Gemini request in ${delay}ms`, {
					attempt: attempt + 1,
					error: lastError.message,
				});

				await new Promise(resolve => setTimeout(resolve, delay));
				delay = Math.min(delay * RETRY_CONFIG.BACKOFF_MULTIPLIER, 60000);
			}
		}

		throw new EmbeddingConnectionError(
			`Failed to connect to Gemini API after ${this.maxRetries + 1} attempts: ${lastError?.message}`,
			'gemini',
			lastError
		);
	}
}
