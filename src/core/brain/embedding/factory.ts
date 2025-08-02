/**
 * Embedding Factory Module
 *
 * Factory functions for creating embedding instances with proper validation,
 * error handling, and type safety. Supports multiple providers and
 * configuration methods.
 */

import { logger } from '../../logger/index.js';
import {
	parseEmbeddingConfigFromEnv,
	// validateEmbeddingConfig,
	// type OpenAIEmbeddingConfig as ZodOpenAIEmbeddingConfig,
	// type GeminiEmbeddingConfig as ZodGeminiEmbeddingConfig,
	// type OllamaEmbeddingConfig as ZodOllamaEmbeddingConfig,
	// type VoyageEmbeddingConfig as ZodVoyageEmbeddingConfig,
	// type QwenEmbeddingConfig as ZodQwenEmbeddingConfig,
	// type AWSBedrockEmbeddingConfig as ZodAWSBedrockEmbeddingConfig,
	// type LMStudioEmbeddingConfig as ZodLMStudioEmbeddingConfig,
} from './config.js';
import { type Embedder, type BackendConfig, EmbeddingValidationError } from './backend/types.js';

// Re-export BackendConfig for external use
export type { BackendConfig } from './backend/types.js';
import { OpenAIEmbedder } from './backend/openai.js';
import { GeminiEmbedder } from './backend/gemini.js';
import { OllamaEmbedder } from './backend/ollama.js';
import { VoyageEmbedder } from './backend/voyage.js';
import { QwenEmbedder } from './backend/qwen.js';
import { AWSBedrockEmbedder } from './backend/aws.js';
import { LMStudioEmbedder } from './backend/lmstudio.js';

/**
 * Embedding factory interface
 */
export interface EmbeddingFactory {
	createEmbedder(config: BackendConfig): Promise<Embedder>;
	validateConfig(config: unknown): boolean;
	getProviderType(): string;
}

/**
 * OpenAI embedding factory
 */
export class OpenAIEmbeddingFactory implements EmbeddingFactory {
	async createEmbedder(config: BackendConfig): Promise<Embedder> {
		if (config.type !== 'openai') {
			throw new EmbeddingValidationError('Invalid config type for OpenAI factory');
		}
		return new OpenAIEmbedder(config);
	}

	validateConfig(config: unknown): boolean {
		try {
			return typeof config === 'object' && config !== null && (config as any).type === 'openai';
		} catch {
			return false;
		}
	}

	getProviderType(): string {
		return 'openai';
	}
}

/**
 * Gemini embedding factory
 */
export class GeminiEmbeddingFactory implements EmbeddingFactory {
	async createEmbedder(config: BackendConfig): Promise<Embedder> {
		if (config.type !== 'gemini') {
			throw new EmbeddingValidationError('Invalid config type for Gemini factory');
		}
		return new GeminiEmbedder(config);
	}

	validateConfig(config: unknown): boolean {
		try {
			return typeof config === 'object' && config !== null && (config as any).type === 'gemini';
		} catch {
			return false;
		}
	}

	getProviderType(): string {
		return 'gemini';
	}
}

/**
 * Ollama embedding factory
 */
export class OllamaEmbeddingFactory implements EmbeddingFactory {
	async createEmbedder(config: BackendConfig): Promise<Embedder> {
		if (config.type !== 'ollama') {
			throw new EmbeddingValidationError('Invalid config type for Ollama factory');
		}
		return new OllamaEmbedder(config);
	}

	validateConfig(config: unknown): boolean {
		try {
			return typeof config === 'object' && config !== null && (config as any).type === 'ollama';
		} catch {
			return false;
		}
	}

	getProviderType(): string {
		return 'ollama';
	}
}

/**
 * Voyage embedding factory
 */
export class VoyageEmbeddingFactory implements EmbeddingFactory {
	async createEmbedder(config: BackendConfig): Promise<Embedder> {
		if (config.type !== 'voyage') {
			throw new EmbeddingValidationError('Invalid config type for Voyage factory');
		}
		return new VoyageEmbedder(config);
	}

	validateConfig(config: unknown): boolean {
		try {
			return typeof config === 'object' && config !== null && (config as any).type === 'voyage';
		} catch {
			return false;
		}
	}

	getProviderType(): string {
		return 'voyage';
	}
}

/**
 * Qwen embedding factory
 */
export class QwenEmbeddingFactory implements EmbeddingFactory {
	async createEmbedder(config: BackendConfig): Promise<Embedder> {
		if (config.type !== 'qwen') {
			throw new EmbeddingValidationError('Invalid config type for Qwen factory');
		}
		return new QwenEmbedder(config);
	}

	validateConfig(config: unknown): boolean {
		try {
			return typeof config === 'object' && config !== null && (config as any).type === 'qwen';
		} catch {
			return false;
		}
	}

	getProviderType(): string {
		return 'qwen';
	}
}

/**
 * AWS Bedrock embedding factory
 */
export class AWSBedrockEmbeddingFactory implements EmbeddingFactory {
	async createEmbedder(config: BackendConfig): Promise<Embedder> {
		if (config.type !== 'aws-bedrock') {
			throw new EmbeddingValidationError('Invalid config type for AWS Bedrock factory');
		}
		return new AWSBedrockEmbedder(config);
	}

	validateConfig(config: unknown): boolean {
		try {
			return (
				typeof config === 'object' && config !== null && (config as any).type === 'aws-bedrock'
			);
		} catch {
			return false;
		}
	}

	getProviderType(): string {
		return 'aws-bedrock';
	}
}

/**
 * LM Studio embedding factory
 */
export class LMStudioEmbeddingFactory implements EmbeddingFactory {
	async createEmbedder(config: BackendConfig): Promise<Embedder> {
		if (config.type !== 'lmstudio') {
			throw new EmbeddingValidationError('Invalid config type for LM Studio factory');
		}
		return new LMStudioEmbedder(config);
	}

	validateConfig(config: unknown): boolean {
		try {
			return typeof config === 'object' && config !== null && (config as any).type === 'lmstudio';
		} catch {
			return false;
		}
	}

	getProviderType(): string {
		return 'lmstudio';
	}
}

/**
 * Registry of available embedding factories
 */
export const EMBEDDING_FACTORIES = new Map<string, EmbeddingFactory>([
	['openai', new OpenAIEmbeddingFactory()],
	['gemini', new GeminiEmbeddingFactory()],
	['ollama', new OllamaEmbeddingFactory()],
	['voyage', new VoyageEmbeddingFactory()],
	['qwen', new QwenEmbeddingFactory()],
	['aws-bedrock', new AWSBedrockEmbeddingFactory()],
	['lmstudio', new LMStudioEmbeddingFactory()],
]);

/**
 * Create embedder from configuration
 */
export async function createEmbedder(config: BackendConfig): Promise<Embedder> {
	const factory = EMBEDDING_FACTORIES.get(config.type);
	if (!factory) {
		throw new EmbeddingValidationError(`Unsupported embedding provider: ${config.type}`);
	}

	logger.debug('Creating embedder', { provider: config.type, model: config.model });
	return factory.createEmbedder(config);
}

/**
 * Create embedder from environment configuration
 */
export async function createEmbedderFromEnv(): Promise<{ embedder: Embedder; info: any } | null> {
	const envConfig = parseEmbeddingConfigFromEnv();
	if (!envConfig) {
		logger.debug('No embedding configuration found in environment');
		return null;
	}

	try {
		// Convert env config to proper backend config
		const backendConfig: BackendConfig = {
			...envConfig,
			timeout: 30000,
			maxRetries: 3,
		} as BackendConfig;

		const embedder = await createEmbedder(backendConfig);
		const info = {
			provider: envConfig.type,
			model: envConfig.model || 'default',
			dimension: embedder.getDimension(),
		};

		return { embedder, info };
	} catch (error) {
		logger.warn('Failed to create embedder from environment config', {
			error: error instanceof Error ? error.message : String(error),
			type: envConfig.type,
		});
		return null;
	}
}

/**
 * Validate embedding configuration
 */
export function validateEmbeddingConfiguration(config: unknown): boolean {
	if (!config || typeof config !== 'object') {
		return false;
	}

	const configObj = config as any;
	const factory = EMBEDDING_FACTORIES.get(configObj.type);
	return factory ? factory.validateConfig(config) : false;
}

/**
 * Get supported embedding providers
 */
export function getSupportedProviders(): string[] {
	return Array.from(EMBEDDING_FACTORIES.keys());
}

/**
 * Check if provider is supported
 */
export function isProviderSupported(provider: string): boolean {
	return EMBEDDING_FACTORIES.has(provider);
}
