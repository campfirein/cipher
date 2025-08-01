/**
 * Embedding Factory Tests
 *
 * Tests for the embedding factory functions including provider support,
 * configuration validation, and embedder creation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	createEmbedder,
	createEmbedderFromEnv,
	validateEmbeddingConfiguration,
	getSupportedProviders,
	isProviderSupported,
	EMBEDDING_FACTORIES,
	OpenAIEmbeddingFactory,
	GeminiEmbeddingFactory,
	OllamaEmbeddingFactory,
	VoyageEmbeddingFactory,
	QwenEmbeddingFactory,
	AWSBedrockEmbeddingFactory,
	LMStudioEmbeddingFactory,
} from '../factory.js';
import type { BackendConfig } from '../backend/types.js';
import { EmbeddingValidationError } from '../backend/types.js';

// Mock all embedding backends
vi.mock('../backend/openai.js', () => ({
	OpenAIEmbedder: vi.fn(() => ({
		getDimension: () => 1536,
		getConfig: () => ({ type: 'openai' }),
	})),
}));

vi.mock('../backend/gemini.js', () => ({
	GeminiEmbedder: vi.fn(() => ({
		getDimension: () => 768,
		getConfig: () => ({ type: 'gemini' }),
	})),
}));

vi.mock('../backend/ollama.js', () => ({
	OllamaEmbedder: vi.fn(() => ({
		getDimension: () => 768,
		getConfig: () => ({ type: 'ollama' }),
	})),
}));

vi.mock('../backend/voyage.js', () => ({
	VoyageEmbedder: vi.fn(() => ({
		getDimension: () => 1024,
		getConfig: () => ({ type: 'voyage' }),
	})),
}));

vi.mock('../backend/qwen.js', () => ({
	QwenEmbedder: vi.fn(() => ({
		getDimension: () => 1024,
		getConfig: () => ({ type: 'qwen' }),
	})),
}));

vi.mock('../backend/aws.js', () => ({
	AWSBedrockEmbedder: vi.fn(() => ({
		getDimension: () => 1024,
		getConfig: () => ({ type: 'aws-bedrock' }),
	})),
}));

vi.mock('../backend/lmstudio.js', () => ({
	LMStudioEmbedder: vi.fn(() => ({
		getDimension: () => 768,
		getConfig: () => ({ type: 'lmstudio' }),
	})),
}));

describe('Embedding Factory', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Clear environment variables
		delete process.env.OPENAI_API_KEY;
		delete process.env.GEMINI_API_KEY;
		delete process.env.OLLAMA_BASE_URL;
		delete process.env.LMSTUDIO_BASE_URL;
		delete process.env.QWEN_API_KEY;
		delete process.env.DASHSCOPE_API_KEY;
		delete process.env.AWS_ACCESS_KEY_ID;
		delete process.env.AWS_SECRET_ACCESS_KEY;
		delete process.env.VOYAGE_API_KEY;
	});

	describe('Provider Support', () => {
		it('should return all supported providers', () => {
			const providers = getSupportedProviders();
			expect(providers).toContain('openai');
			expect(providers).toContain('gemini');
			expect(providers).toContain('ollama');
			expect(providers).toContain('voyage');
			expect(providers).toContain('qwen');
			expect(providers).toContain('aws-bedrock');
			expect(providers).toContain('lmstudio');
			expect(providers).toHaveLength(7);
		});

		it('should correctly identify supported providers', () => {
			expect(isProviderSupported('openai')).toBe(true);
			expect(isProviderSupported('gemini')).toBe(true);
			expect(isProviderSupported('ollama')).toBe(true);
			expect(isProviderSupported('voyage')).toBe(true);
			expect(isProviderSupported('qwen')).toBe(true);
			expect(isProviderSupported('aws-bedrock')).toBe(true);
			expect(isProviderSupported('lmstudio')).toBe(true);
			expect(isProviderSupported('unsupported')).toBe(false);
		});

		it('should have factory instances for all supported providers', () => {
			const providers = getSupportedProviders();
			providers.forEach(provider => {
				expect(EMBEDDING_FACTORIES.has(provider)).toBe(true);
				expect(EMBEDDING_FACTORIES.get(provider)).toBeDefined();
			});
		});
	});

	describe('Factory Classes', () => {
		describe('OpenAIEmbeddingFactory', () => {
			const factory = new OpenAIEmbeddingFactory();

			it('should validate correct config', () => {
				expect(factory.validateConfig({ type: 'openai' })).toBe(true);
				expect(factory.validateConfig({ type: 'gemini' })).toBe(false);
				expect(factory.validateConfig(null)).toBe(false);
			});

			it('should return correct provider type', () => {
				expect(factory.getProviderType()).toBe('openai');
			});

			it('should create embedder for valid config', async () => {
				const config: BackendConfig = { type: 'openai', apiKey: 'test-key' };
				const embedder = await factory.createEmbedder(config);
				expect(embedder).toBeDefined();
			});

			it('should reject invalid config type', async () => {
				const config = { type: 'gemini' } as any;
				await expect(factory.createEmbedder(config)).rejects.toThrow(EmbeddingValidationError);
			});
		});

		describe('LMStudioEmbeddingFactory', () => {
			const factory = new LMStudioEmbeddingFactory();

			it('should validate correct config', () => {
				expect(factory.validateConfig({ type: 'lmstudio' })).toBe(true);
				expect(factory.validateConfig({ type: 'openai' })).toBe(false);
				expect(factory.validateConfig(null)).toBe(false);
			});

			it('should return correct provider type', () => {
				expect(factory.getProviderType()).toBe('lmstudio');
			});

			it('should create embedder for valid config', async () => {
				const config: BackendConfig = {
					type: 'lmstudio',
					baseUrl: 'http://localhost:1234/v1',
					model: 'nomic-embed-text-v1.5',
				};
				const embedder = await factory.createEmbedder(config);
				expect(embedder).toBeDefined();
			});

			it('should reject invalid config type', async () => {
				const config = { type: 'openai' } as any;
				await expect(factory.createEmbedder(config)).rejects.toThrow(EmbeddingValidationError);
			});
		});
	});

	describe('createEmbedder', () => {
		it('should create embedders for all supported providers', async () => {
			const configs: BackendConfig[] = [
				{ type: 'openai', apiKey: 'test-key' },
				{ type: 'gemini', apiKey: 'test-key' },
				{ type: 'ollama', baseUrl: 'http://localhost:11434' },
				{ type: 'voyage', apiKey: 'test-key' },
				{ type: 'qwen', apiKey: 'test-key' },
				{ type: 'aws-bedrock', region: 'us-east-1' },
				{ type: 'lmstudio', baseUrl: 'http://localhost:1234/v1' },
			];

			for (const config of configs) {
				const embedder = await createEmbedder(config);
				expect(embedder).toBeDefined();
				expect(embedder.getConfig().type).toBe(config.type);
			}
		});

		it('should throw error for unsupported provider', async () => {
			const config = { type: 'unsupported' } as any;
			await expect(createEmbedder(config)).rejects.toThrow(EmbeddingValidationError);
		});
	});

	describe('createEmbedderFromEnv', () => {
		it('should create OpenAI embedder when OPENAI_API_KEY is set', async () => {
			process.env.OPENAI_API_KEY = 'test-openai-key';

			const result = await createEmbedderFromEnv();

			expect(result).toBeDefined();
			expect(result!.info.provider).toBe('openai');
			expect(result!.embedder).toBeDefined();
		});

		it('should create Gemini embedder when GEMINI_API_KEY is set', async () => {
			process.env.GEMINI_API_KEY = 'test-gemini-key';

			const result = await createEmbedderFromEnv();

			expect(result).toBeDefined();
			expect(result!.info.provider).toBe('gemini');
			expect(result!.embedder).toBeDefined();
		});

		it('should create Ollama embedder when OLLAMA_BASE_URL is set', async () => {
			process.env.OLLAMA_BASE_URL = 'http://localhost:11434';

			const result = await createEmbedderFromEnv();

			expect(result).toBeDefined();
			expect(result!.info.provider).toBe('ollama');
			expect(result!.embedder).toBeDefined();
		});

		it('should create LM Studio embedder when LMSTUDIO_BASE_URL is set', async () => {
			process.env.LMSTUDIO_BASE_URL = 'http://localhost:1234/v1';

			const result = await createEmbedderFromEnv();

			expect(result).toBeDefined();
			expect(result!.info.provider).toBe('lmstudio');
			expect(result!.embedder).toBeDefined();
		});

		it('should create Qwen embedder when QWEN_API_KEY is set', async () => {
			process.env.QWEN_API_KEY = 'test-qwen-key';

			const result = await createEmbedderFromEnv();

			expect(result).toBeDefined();
			expect(result!.info.provider).toBe('qwen');
			expect(result!.embedder).toBeDefined();
		});

		it('should create AWS Bedrock embedder when AWS credentials are set', async () => {
			process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
			process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';

			const result = await createEmbedderFromEnv();

			expect(result).toBeDefined();
			expect(result!.info.provider).toBe('aws-bedrock');
			expect(result!.embedder).toBeDefined();
		});

		it('should return null when no environment configuration is found', async () => {
			const result = await createEmbedderFromEnv();
			expect(result).toBeNull();
		});

		it('should prioritize OpenAI over other providers', async () => {
			process.env.OPENAI_API_KEY = 'test-openai-key';
			process.env.GEMINI_API_KEY = 'test-gemini-key';
			process.env.OLLAMA_BASE_URL = 'http://localhost:11434';

			const result = await createEmbedderFromEnv();

			expect(result).toBeDefined();
			expect(result!.info.provider).toBe('openai');
		});
	});

	describe('validateEmbeddingConfiguration', () => {
		it('should validate correct configurations', () => {
			const validConfigs = [
				{ type: 'openai', apiKey: 'test-key' },
				{ type: 'gemini', apiKey: 'test-key' },
				{ type: 'ollama', baseUrl: 'http://localhost:11434' },
				{ type: 'voyage', apiKey: 'test-key' },
				{ type: 'qwen', apiKey: 'test-key' },
				{ type: 'aws-bedrock', region: 'us-east-1' },
				{ type: 'lmstudio', baseUrl: 'http://localhost:1234/v1' },
			];

			validConfigs.forEach(config => {
				expect(validateEmbeddingConfiguration(config)).toBe(true);
			});
		});

		it('should reject invalid configurations', () => {
			const invalidConfigs = [
				null,
				undefined,
				'not an object',
				{},
				{ type: 'unsupported' },
				{ provider: 'openai' }, // Wrong property name
			];

			invalidConfigs.forEach(config => {
				expect(validateEmbeddingConfiguration(config)).toBe(false);
			});
		});
	});

	describe('Error Handling', () => {
		it('should handle factory creation errors gracefully', async () => {
			// Mock a factory that throws during embedder creation
			const mockFactory = {
				createEmbedder: vi.fn().mockRejectedValue(new Error('Creation failed')),
				validateConfig: vi.fn().mockReturnValue(true),
				getProviderType: vi.fn().mockReturnValue('mock'),
			};

			EMBEDDING_FACTORIES.set('mock', mockFactory);

			const config = { type: 'mock' } as any;
			await expect(createEmbedder(config)).rejects.toThrow('Creation failed');

			// Clean up
			EMBEDDING_FACTORIES.delete('mock');
		});

		it('should handle environment parsing errors gracefully', async () => {
			// Clear any existing environment variables that might interfere
			delete process.env.OPENAI_API_KEY;
			delete process.env.GEMINI_API_KEY;
			delete process.env.OLLAMA_BASE_URL;
			delete process.env.LMSTUDIO_BASE_URL;

			// Test with no environment variables - should return null
			const result = await createEmbedderFromEnv();
			expect(result).toBeNull();
		});
	});
});
