/**
 * AWS Bedrock Embedding Backend
 *
 * Implementation of the AWS Bedrock embedding provider supporting Amazon Titan
 * and Cohere embedding models through the Bedrock Runtime API.
 */

import {
	BedrockRuntimeClient,
	BedrockRuntimeClientConfig,
	InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { TextDecoder } from 'util';
import type { Embedder, EmbeddingConfig } from './types.js';
import { EmbeddingError, EmbeddingConnectionError, EmbeddingValidationError } from './types.js';

/**
 * AWS Bedrock-specific configuration interface
 */
export interface AWSBedrockEmbeddingConfig extends EmbeddingConfig {
	type: 'aws-bedrock';
	model?: 'amazon.titan-embed-text-v2:0' | 'cohere.embed-english-v3';
	region?: string;
	accessKeyId?: string;
	secretAccessKey?: string;
	sessionToken?: string;
	dimensions?: 1024 | 512 | 256; // For Titan V2
}

/**
 * AWS Bedrock embedding provider implementation
 */
export class AWSBedrockEmbedder implements Embedder {
	private readonly config: AWSBedrockEmbeddingConfig;
	private readonly client: BedrockRuntimeClient;
	private readonly model: string;
	private readonly dimensions: number;

	constructor(config: AWSBedrockEmbeddingConfig) {
		this.config = config;
		this.model = config.model || 'amazon.titan-embed-text-v2:0';
		this.dimensions = config.dimensions || 1024;

		// Configure AWS Bedrock client
		const clientConfig: BedrockRuntimeClientConfig = {
			region: config.region || process.env.AWS_DEFAULT_REGION || 'us-east-1',
		};

		// Add credentials if provided
		const accessKeyId = config.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
		const secretAccessKey = config.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
		const sessionToken = config.sessionToken || process.env.AWS_SESSION_TOKEN;

		if (accessKeyId && secretAccessKey) {
			clientConfig.credentials = {
				accessKeyId,
				secretAccessKey,
				...(sessionToken && { sessionToken }),
			};
		}

		this.client = new BedrockRuntimeClient(clientConfig);
	}

	async embed(text: string): Promise<number[]> {
		try {
			const body = this.buildRequestBody(text);
			const command = new InvokeModelCommand({
				modelId: this.model,
				body: JSON.stringify(body),
				contentType: 'application/json',
				accept: 'application/json',
			});

			const response = await this.client.send(command);
			const responseBody = JSON.parse(new TextDecoder().decode(response.body));

			return this.extractEmbedding(responseBody);
		} catch (error) {
			if (error instanceof EmbeddingError) {
				throw error;
			}
			throw new EmbeddingError(`Failed to generate AWS Bedrock embedding: ${error}`);
		}
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		try {
			// AWS Bedrock typically processes one text at a time, so we batch manually
			const results: number[][] = [];

			for (const text of texts) {
				const embedding = await this.embed(text);
				results.push(embedding);
			}

			return results;
		} catch (error) {
			if (error instanceof EmbeddingError) {
				throw error;
			}
			throw new EmbeddingError(`Failed to generate AWS Bedrock batch embeddings: ${error}`);
		}
	}

	getDimension(): number {
		return this.dimensions;
	}

	getConfig(): AWSBedrockEmbeddingConfig {
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
		// AWS SDK handles connection management automatically
		this.client.destroy();
	}

	private buildRequestBody(text: string): any {
		if (this.model.startsWith('amazon.titan-embed')) {
			return {
				inputText: text,
				dimensions: this.dimensions,
			};
		} else if (this.model.startsWith('cohere.embed')) {
			return {
				texts: [text],
				input_type: 'search_document',
				embedding_types: ['float'],
			};
		}

		throw new EmbeddingValidationError(`Unsupported AWS Bedrock model: ${this.model}`);
	}

	private extractEmbedding(response: any): number[] {
		if (this.model.startsWith('amazon.titan-embed')) {
			if (!response.embedding) {
				throw new EmbeddingError('No embedding data received from AWS Bedrock Titan API');
			}
			return response.embedding;
		} else if (this.model.startsWith('cohere.embed')) {
			if (!response.embeddings || response.embeddings.length === 0) {
				throw new EmbeddingError('No embedding data received from AWS Bedrock Cohere API');
			}
			return response.embeddings[0].values;
		}

		throw new EmbeddingError(`Unknown response format for model: ${this.model}`);
	}
}

/**
 * Factory function to create an AWS Bedrock embedder
 */
export function createAWSBedrockEmbedder(config: AWSBedrockEmbeddingConfig): AWSBedrockEmbedder {
	return new AWSBedrockEmbedder(config);
}
