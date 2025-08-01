/**
 * Ollama Embedding Backend
 *
 * Implementation of the Embedder interface for Ollama's local embedding models.
 * Supports various open-source embedding models running locally via Ollama.
 *
 * @module embedding/backend/ollama
 */

import { logger } from '../../../logger/index.js';
import {
	type Embedder,
	type OllamaEmbeddingConfig,
	type EmbeddingConfig,
	EmbeddingError,
	EmbeddingConnectionError,
	EmbeddingValidationError,
} from './types.js';
import {
	LOG_PREFIXES,
	VALIDATION_LIMITS,
	RETRY_CONFIG,
	HTTP_STATUS,
	MODEL_DIMENSIONS,
} from '../constants.js';

/**
 * Ollama API response for text embedding
 */
interface OllamaEmbeddingResponse {
	embedding: number[];
}

/**
 * Ollama API error response
 */
interface OllamaErrorResponse {
	error: string;
}

/**
 * Ollama Embedder Implementation
 *
 * Provides embedding functionality using local Ollama embedding models.
 * Supports various open-source models like nomic-embed-text, all-minilm, etc.
 */
export class OllamaEmbedder implements Embedder {
	private readonly config: OllamaEmbeddingConfig;
	private readonly baseUrl: string;
	private readonly model: string;
	private readonly dimension: number;
	private readonly timeout: number;
	private readonly maxRetries: number;

	constructor(config: OllamaEmbeddingConfig) {
		this.config = config;
		this.model = config.model || 'nomic-embed-text';
		this.timeout = config.timeout || 30000;
		this.maxRetries = config.maxRetries || 3;
		this.baseUrl = config.baseUrl || 'http://localhost:11434';

		// Get dimension from model constants or use default
		this.dimension =
			config.dimensions || MODEL_DIMENSIONS[this.model as keyof typeof MODEL_DIMENSIONS] || 768;

		logger.debug(`${LOG_PREFIXES.EMBEDDING} Ollama embedder initialized`, {
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
			logger.debug(`${LOG_PREFIXES.EMBEDDING} Starting Ollama embedding`, {
				textLength: text.length,
				model: this.model,
			});

			const response = await this.makeRequest('/api/embeddings', {
				model: this.model,
				prompt: text,
			});

			const embedding = response.embedding;
			const processingTime = Date.now() - startTime;

			if (!embedding || !Array.isArray(embedding)) {
				throw new EmbeddingError('Invalid embedding response from Ollama API', 'ollama');
			}

			// Update dimension if it differs from expected
			if (embedding.length !== this.dimension) {
				logger.debug(
					`${LOG_PREFIXES.EMBEDDING} Updating dimension from ${this.dimension} to ${embedding.length}`
				);
				(this as any).dimension = embedding.length;
			}

			logger.debug(`${LOG_PREFIXES.EMBEDDING} Ollama embedding completed`, {
				dimension: embedding.length,
				processingTime,
			});

			return embedding;
		} catch (error) {
			const processingTime = Date.now() - startTime;
			logger.error(`${LOG_PREFIXES.EMBEDDING} Ollama embedding failed`, {
				error: error instanceof Error ? error.message : String(error),
				processingTime,
			});

			if (error instanceof EmbeddingError) {
				throw error;
			}

			throw new EmbeddingError(
				`Ollama embedding failed: ${error instanceof Error ? error.message : String(error)}`,
				'ollama',
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
			logger.debug(`${LOG_PREFIXES.EMBEDDING} Starting Ollama batch embedding`, {
				batchSize: texts.length,
				model: this.model,
			});

			// Ollama doesn't support batch embeddings, so process sequentially
			// For better performance, we could parallelize with a concurrency limit
			const embeddings: number[][] = [];

			for (const text of texts) {
				const embedding = await this.embed(text);
				embeddings.push(embedding);
			}

			const processingTime = Date.now() - startTime;

			logger.debug(`${LOG_PREFIXES.EMBEDDING} Ollama batch embedding completed`, {
				batchSize: embeddings.length,
				dimension: embeddings[0]?.length,
				processingTime,
			});

			return embeddings;
		} catch (error) {
			const processingTime = Date.now() - startTime;
			logger.error(`${LOG_PREFIXES.EMBEDDING} Ollama batch embedding failed`, {
				error: error instanceof Error ? error.message : String(error),
				batchSize: texts.length,
				processingTime,
			});

			if (error instanceof EmbeddingError) {
				throw error;
			}

			throw new EmbeddingError(
				`Ollama batch embedding failed: ${error instanceof Error ? error.message : String(error)}`,
				'ollama',
				error instanceof Error ? error : undefined
			);
		}
	}

	async isHealthy(): Promise<boolean> {
		try {
			logger.debug(`${LOG_PREFIXES.EMBEDDING} Checking Ollama embedder health`);

			// Test connection with a simple text
			await this.embed('health check');

			logger.debug(`${LOG_PREFIXES.EMBEDDING} Ollama embedder is healthy`);
			return true;
		} catch (error) {
			logger.warn(`${LOG_PREFIXES.EMBEDDING} Ollama embedder health check failed`, {
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
		return 'ollama';
	}

	getConfig(): EmbeddingConfig {
		return this.config;
	}

	async disconnect(): Promise<void> {
		// Ollama API is stateless, no cleanup needed
		logger.debug(`${LOG_PREFIXES.EMBEDDING} Ollama embedder disconnected`);
	}

	/**
	 * Make request to Ollama API
	 */
	private async makeRequest(endpoint: string, body: any): Promise<OllamaEmbeddingResponse> {
		const url = `${this.baseUrl}${endpoint}`;

		let lastError: Error | undefined;
		let delay: number = RETRY_CONFIG.INITIAL_DELAY;

		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			try {
				logger.silly(`${LOG_PREFIXES.EMBEDDING} Making Ollama API request`, {
					attempt: attempt + 1,
					maxRetries: this.maxRetries + 1,
					endpoint,
					baseUrl: this.baseUrl,
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
					const errorText = await response.text().catch(() => 'Unknown error');
					let errorData: OllamaErrorResponse;

					try {
						errorData = JSON.parse(errorText) as OllamaErrorResponse;
					} catch {
						errorData = { error: errorText };
					}

					const errorMessage = errorData.error || `HTTP ${response.status}`;

					switch (response.status) {
						case HTTP_STATUS.NOT_FOUND:
							throw new EmbeddingValidationError(
								`Ollama model '${this.model}' not found. Make sure the model is pulled: ollama pull ${this.model}`
							);
						case HTTP_STATUS.BAD_REQUEST:
							throw new EmbeddingValidationError(`Invalid request to Ollama API: ${errorMessage}`);
						case HTTP_STATUS.SERVICE_UNAVAILABLE:
							throw new EmbeddingConnectionError(
								`Ollama service unavailable. Make sure Ollama is running: ${errorMessage}`
							);
						default:
							throw new EmbeddingConnectionError(`Ollama API error: ${errorMessage}`);
					}
				}

				const data = (await response.json()) as OllamaEmbeddingResponse;

				if (!data.embedding) {
					throw new EmbeddingError('Invalid response format from Ollama API', 'ollama');
				}

				return data;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				logger.error(`${LOG_PREFIXES.EMBEDDING} Ollama API request failed`, {
					attempt: attempt + 1,
					error: lastError.message,
					errorType: lastError.constructor.name,
					stack: lastError.stack,
					url,
					body: JSON.stringify(body),
				});

				// Don't retry on validation errors
				if (error instanceof EmbeddingValidationError || error instanceof EmbeddingError) {
					throw error;
				}

				// If this was the last attempt, throw the error
				if (attempt === this.maxRetries) {
					break;
				}

				// Wait before retrying
				logger.debug(`${LOG_PREFIXES.EMBEDDING} Retrying Ollama request in ${delay}ms`, {
					attempt: attempt + 1,
					error: lastError.message,
				});

				await new Promise(resolve => setTimeout(resolve, delay));
				delay = Math.min(delay * RETRY_CONFIG.BACKOFF_MULTIPLIER, 60000);
			}
		}

		throw new EmbeddingConnectionError(
			`Failed to connect to Ollama API after ${this.maxRetries + 1} attempts: ${lastError?.message}. Make sure Ollama is running at ${this.baseUrl}`,
			'ollama',
			lastError
		);
	}
}
