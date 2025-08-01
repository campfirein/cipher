/**
 * Qwen Embedding Backend
 *
 * Implementation of the Alibaba Cloud Qwen (DashScope) embedding provider.
 * Supports the text-embedding-v3 model through DashScope API.
 */

import type { Embedder, EmbeddingConfig } from './types.js';
import { EmbeddingError, EmbeddingConnectionError, EmbeddingValidationError } from './types.js';

/**
 * Qwen-specific configuration interface
 */
export interface QwenEmbeddingConfig extends EmbeddingConfig {
	type: 'qwen';
	model?: 'text-embedding-v3';
	baseUrl?: string;
	dimensions?: 1024 | 768 | 512;
}

/**
 * Qwen embedding provider implementation using DashScope API
 */
export class QwenEmbedder implements Embedder {
	private readonly config: QwenEmbeddingConfig;
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly model: string;
	private readonly dimensions: number;

	constructor(config: QwenEmbeddingConfig) {
		this.config = config;
		this.apiKey = config.apiKey || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '';
		this.baseUrl = config.baseUrl || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
		this.model = config.model || 'text-embedding-v3';
		this.dimensions = config.dimensions || 1024;

		if (!this.apiKey) {
			throw new EmbeddingValidationError(
				'Qwen API key is required (QWEN_API_KEY or DASHSCOPE_API_KEY)'
			);
		}
	}

	async embed(text: string): Promise<number[]> {
		try {
			const response = await this.makeRequest({
				model: this.model,
				input: [text],
				dimensions: this.dimensions,
			});

			if (!response.data || response.data.length === 0) {
				throw new EmbeddingError('No embedding data received from Qwen API');
			}

			return response.data[0].embedding;
		} catch (error) {
			if (error instanceof EmbeddingError) {
				throw error;
			}
			throw new EmbeddingError(`Failed to generate Qwen embedding: ${error}`);
		}
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		try {
			// Qwen supports up to 10 texts per request
			const batchSize = 10;
			const results: number[][] = [];

			for (let i = 0; i < texts.length; i += batchSize) {
				const batch = texts.slice(i, i + batchSize);
				const response = await this.makeRequest({
					model: this.model,
					input: batch,
					dimensions: this.dimensions,
				});

				if (!response.data || response.data.length !== batch.length) {
					throw new EmbeddingError('Unexpected response format from Qwen API');
				}

				results.push(...response.data.map((item: any) => item.embedding));
			}

			return results;
		} catch (error) {
			if (error instanceof EmbeddingError) {
				throw error;
			}
			throw new EmbeddingError(`Failed to generate Qwen batch embeddings: ${error}`);
		}
	}

	getDimension(): number {
		return this.dimensions;
	}

	getConfig(): QwenEmbeddingConfig {
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
					throw new EmbeddingConnectionError(`Qwen API error: ${response.status} ${errorText}`);
				}

				return await response.json();
			} catch (error) {
				if (error instanceof EmbeddingError) {
					throw error;
				}
				if (attempt === maxRetries) {
					throw new EmbeddingConnectionError(
						`Failed to connect to Qwen API after ${maxRetries} attempts: ${error}`
					);
				}
				await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
			}
		}
	}
}

/**
 * Factory function to create a Qwen embedder
 */
export function createQwenEmbedder(config: QwenEmbeddingConfig): QwenEmbedder {
	return new QwenEmbedder(config);
}
