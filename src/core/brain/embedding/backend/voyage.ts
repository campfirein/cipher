/**
 * Voyage Embedding Backend
 *
 * Implementation of the Voyage AI embedding provider for the Cipher embedding system.
 * Provides support for Voyage's embedding models including voyage-3-large.
 */

import { logger } from '../../../logger/index.js';
import type { Embedder, EmbeddingConfig } from './types.js';
import { EmbeddingError, EmbeddingConnectionError, EmbeddingValidationError } from './types.js';
import { LOG_PREFIXES } from '../constants.js';

/**
 * Voyage-specific configuration interface
 */
export interface VoyageEmbeddingConfig extends EmbeddingConfig {
	type: 'voyage';
	model?: 'voyage-3-large' | 'voyage-3' | 'voyage-2';
	baseUrl?: string;
}

/**
 * Voyage embedding provider implementation
 */
export class VoyageEmbedder implements Embedder {
	private readonly config: VoyageEmbeddingConfig;
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly model: string;
	private readonly dimension: number;

	constructor(config: VoyageEmbeddingConfig) {
		this.config = config;
		this.apiKey = config.apiKey || process.env.VOYAGE_API_KEY || '';
		this.baseUrl = config.baseUrl || 'https://api.voyageai.com/v1';
		this.model = config.model || 'voyage-3-large';

		// Set dimension based on model (all Voyage models have 1024 dimensions)
		this.dimension = 1024;

		if (!this.apiKey) {
			throw new EmbeddingValidationError('Voyage API key is required');
		}

		logger.debug(`${LOG_PREFIXES.VOYAGE} Initialized Voyage embedder`, {
			model: this.model,
			dimension: this.dimension,
			baseUrl: this.baseUrl,
			hasApiKey: !!this.apiKey,
		});
	}

	async embed(text: string): Promise<number[]> {
		logger.silly(`${LOG_PREFIXES.VOYAGE} Generating Voyage embedding`, {
			textLength: text.length,
			model: this.model,
		});

		const startTime = Date.now();

		try {
			const response = await this.makeRequest({
				input: [text],
				model: this.model,
			});

			if (!response.data || response.data.length === 0) {
				throw new EmbeddingError('No embedding data received from Voyage API');
			}

			const embedding = response.data[0].embedding;
			const processingTime = Date.now() - startTime;

			logger.debug(`${LOG_PREFIXES.VOYAGE} Successfully generated Voyage embedding`, {
				model: this.model,
				dimension: embedding.length,
				processingTime: `${processingTime}ms`,
				textLength: text.length,
			});

			return embedding;
		} catch (error) {
			const processingTime = Date.now() - startTime;
			logger.error(`${LOG_PREFIXES.VOYAGE} Failed to generate Voyage embedding`, {
				error: error instanceof Error ? error.message : String(error),
				model: this.model,
				processingTime,
				textLength: text.length,
			});

			if (error instanceof EmbeddingError) {
				throw error;
			}
			throw new EmbeddingError(`Failed to generate Voyage embedding: ${error}`);
		}
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		logger.debug(`${LOG_PREFIXES.VOYAGE} Generating Voyage batch embeddings`, {
			count: texts.length,
			model: this.model,
		});

		const startTime = Date.now();

		try {
			const response = await this.makeRequest({
				input: texts,
				model: this.model,
			});

			if (!response.data || response.data.length !== texts.length) {
				throw new EmbeddingError('Unexpected response format from Voyage API');
			}

			const embeddings = response.data.map((item: any) => item.embedding);
			const processingTime = Date.now() - startTime;

			logger.debug(`${LOG_PREFIXES.VOYAGE} Successfully generated Voyage batch embeddings`, {
				model: this.model,
				count: embeddings.length,
				dimension: embeddings[0]?.length || 0,
				processingTime: `${processingTime}ms`,
			});

			return embeddings;
		} catch (error) {
			const processingTime = Date.now() - startTime;
			logger.error(`${LOG_PREFIXES.VOYAGE} Failed to generate Voyage batch embeddings`, {
				error: error instanceof Error ? error.message : String(error),
				model: this.model,
				processingTime,
				count: texts.length,
			});

			if (error instanceof EmbeddingError) {
				throw error;
			}
			throw new EmbeddingError(`Failed to generate Voyage batch embeddings: ${error}`);
		}
	}

	getDimension(): number {
		return this.dimension;
	}

	getConfig(): VoyageEmbeddingConfig {
		return { ...this.config };
	}

	async isHealthy(): Promise<boolean> {
		try {
			await this.embed('test');
			return true;
		} catch {
			return false;
		}
	}

	async disconnect(): Promise<void> {
		// No persistent connections to close for HTTP-based API
		logger.debug(`${LOG_PREFIXES.VOYAGE} Voyage embedder disconnected`);
	}

	private async makeRequest(body: any): Promise<any> {
		const timeout = this.config.timeout || 30000;
		const maxRetries = this.config.maxRetries || 3;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), timeout);

				const response = await globalThis.fetch(`${this.baseUrl}/embeddings`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${this.apiKey}`,
					},
					body: JSON.stringify(body),
					signal: controller.signal,
				});

				clearTimeout(timeoutId);

				if (!response.ok) {
					const errorText = await response.text();
					if (response.status === 429) {
						if (attempt < maxRetries) {
							await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
							continue;
						}
					}
					throw new EmbeddingConnectionError(`Voyage API error: ${response.status} ${errorText}`);
				}

				return await response.json();
			} catch (error) {
				if (error instanceof EmbeddingError) {
					throw error;
				}
				if (attempt === maxRetries) {
					throw new EmbeddingConnectionError(
						`Failed to connect to Voyage API after ${maxRetries} attempts: ${error}`
					);
				}
				await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
			}
		}
	}
}

/**
 * Factory function to create a Voyage embedder
 */
export function createVoyageEmbedder(config: VoyageEmbeddingConfig): VoyageEmbedder {
	return new VoyageEmbedder(config);
}
