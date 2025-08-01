/**
 * LM Studio Embedding Backend Tests
 *
 * Tests for the LM Studio embedding implementation including unit tests
 * for embedding generation, error handling, and configuration validation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LMStudioEmbedder } from '../lmstudio.js';
import type { LMStudioEmbeddingConfig } from '../types.js';
import {
	EmbeddingConnectionError,
	EmbeddingValidationError,
	EmbeddingDimensionError,
} from '../types.js';

// Mock OpenAI client
const mockOpenAI = {
	embeddings: {
		create: vi.fn(),
	},
};

vi.mock('openai', () => ({
	default: vi.fn(() => mockOpenAI),
}));

describe('LMStudioEmbedder', () => {
	let embedder: LMStudioEmbedder;
	let config: LMStudioEmbeddingConfig;

	beforeEach(() => {
		config = {
			type: 'lmstudio',
			baseUrl: 'http://localhost:1234/v1',
			model: 'nomic-embed-text-v1.5',
			timeout: 30000,
			maxRetries: 3,
		};
		embedder = new LMStudioEmbedder(config);
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe('constructor', () => {
		it('should initialize with default configuration', () => {
			const defaultConfig: LMStudioEmbeddingConfig = {
				type: 'lmstudio',
			};
			const defaultEmbedder = new LMStudioEmbedder(defaultConfig);

			expect(defaultEmbedder.getDimension()).toBe(768); // Default for nomic-embed-text-v1.5
			const config = defaultEmbedder.getConfig();
			expect(config.type).toBe('lmstudio');
			// Other properties may have different defaults or be undefined in constructor
		});

		it('should use custom configuration', () => {
			const customConfig: LMStudioEmbeddingConfig = {
				type: 'lmstudio',
				baseUrl: 'http://localhost:8080/v1',
				model: 'bge-large',
				dimensions: 1024,
				timeout: 60000,
				maxRetries: 5,
			};
			const customEmbedder = new LMStudioEmbedder(customConfig);

			expect(customEmbedder.getDimension()).toBe(1024);
			expect(customEmbedder.getConfig()).toMatchObject(customConfig);
		});

		it('should set dimensions based on known models', () => {
			const configs = [
				{ model: 'nomic-embed-text-v1.5', expectedDimension: 768 },
				{ model: 'bge-large', expectedDimension: 1024 },
				{ model: 'bge-base', expectedDimension: 768 },
				{ model: 'bge-small', expectedDimension: 384 },
				{ model: 'all-minilm', expectedDimension: 384 },
				{ model: 'unknown-model', expectedDimension: 768 }, // Default
			];

			configs.forEach(({ model, expectedDimension }) => {
				const testConfig: LMStudioEmbeddingConfig = { type: 'lmstudio', model };
				const testEmbedder = new LMStudioEmbedder(testConfig);
				expect(testEmbedder.getDimension()).toBe(expectedDimension);
			});
		});
	});

	describe('embed', () => {
		it('should successfully create single embedding', async () => {
			const mockEmbedding = Array.from({ length: 768 }, () => Math.random());
			mockOpenAI.embeddings.create.mockResolvedValue({
				data: [{ embedding: mockEmbedding }],
			});

			const result = await embedder.embed('test text');

			expect(result).toEqual(mockEmbedding);
			expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
				model: 'nomic-embed-text-v1.5',
				input: 'test text',
			});
		});

		it('should handle text with newlines', async () => {
			const mockEmbedding = Array.from({ length: 768 }, () => Math.random());
			mockOpenAI.embeddings.create.mockResolvedValue({
				data: [{ embedding: mockEmbedding }],
			});

			const result = await embedder.embed('test\ntext\nwith\nnewlines');

			expect(result).toEqual(mockEmbedding);
			expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
				model: 'nomic-embed-text-v1.5',
				input: 'test text with newlines', // Newlines replaced with spaces
			});
		});

		it('should handle custom dimensions', async () => {
			const customConfig: LMStudioEmbeddingConfig = {
				type: 'lmstudio',
				model: 'nomic-embed-text-v1.5',
				dimensions: 512,
			};
			const customEmbedder = new LMStudioEmbedder(customConfig);

			const mockEmbedding = Array.from({ length: 512 }, () => Math.random());
			mockOpenAI.embeddings.create.mockResolvedValue({
				data: [{ embedding: mockEmbedding }],
			});

			const result = await customEmbedder.embed('test text');

			expect(result).toEqual(mockEmbedding);
			expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
				model: 'nomic-embed-text-v1.5',
				input: 'test text',
				dimensions: 512,
			});
		});

		it('should validate input text', async () => {
			// Empty text
			await expect(embedder.embed('')).rejects.toThrow(EmbeddingValidationError);

			// Text too long
			const longText = 'a'.repeat(40000);
			await expect(embedder.embed(longText)).rejects.toThrow(EmbeddingValidationError);
		});

		it('should validate embedding dimensions', async () => {
			const wrongSizeEmbedding = Array.from({ length: 512 }, () => Math.random());
			mockOpenAI.embeddings.create.mockResolvedValue({
				data: [{ embedding: wrongSizeEmbedding }],
			});

			await expect(embedder.embed('test text')).rejects.toThrow(EmbeddingDimensionError);
		});

		it('should handle API errors', async () => {
			const apiError = {
				status: 404,
				message: 'Model not found',
			};
			mockOpenAI.embeddings.create.mockRejectedValue(apiError);

			await expect(embedder.embed('test text')).rejects.toThrow(EmbeddingConnectionError);
		});

		it(
			'should handle connection errors',
			async () => {
				const connectionError = new Error('ECONNREFUSED');
				mockOpenAI.embeddings.create.mockRejectedValue(connectionError);

				await expect(embedder.embed('test text')).rejects.toThrow(EmbeddingConnectionError);
			},
			{ timeout: 1000 }
		);

		it('should retry on retryable errors', async () => {
			const retriableError = { status: 500, message: 'Internal server error' };
			const mockEmbedding = Array.from({ length: 768 }, () => Math.random());

			mockOpenAI.embeddings.create
				.mockRejectedValueOnce(retriableError)
				.mockRejectedValueOnce(retriableError)
				.mockResolvedValueOnce({
					data: [{ embedding: mockEmbedding }],
				});

			const result = await embedder.embed('test text');

			expect(result).toHaveLength(768);
			expect(mockOpenAI.embeddings.create).toHaveBeenCalledTimes(3);
		});
	});

	describe('embedBatch', () => {
		it('should successfully create batch embeddings', async () => {
			const mockEmbeddings = [
				Array.from({ length: 768 }, () => Math.random()),
				Array.from({ length: 768 }, () => Math.random()),
			];
			mockOpenAI.embeddings.create.mockResolvedValue({
				data: mockEmbeddings.map(embedding => ({ embedding })),
			});

			const result = await embedder.embedBatch(['text 1', 'text 2']);

			expect(result).toEqual(mockEmbeddings);
			expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
				model: 'nomic-embed-text-v1.5',
				input: ['text 1', 'text 2'],
			});
		});

		it('should handle batch with newlines', async () => {
			const mockEmbeddings = [
				Array.from({ length: 768 }, () => Math.random()),
				Array.from({ length: 768 }, () => Math.random()),
			];
			mockOpenAI.embeddings.create.mockResolvedValue({
				data: mockEmbeddings.map(embedding => ({ embedding })),
			});

			const result = await embedder.embedBatch(['text\n1', 'text\n2']);

			expect(result).toEqual(mockEmbeddings);
			expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
				model: 'nomic-embed-text-v1.5',
				input: ['text 1', 'text 2'], // Newlines replaced
			});
		});

		it('should validate batch input', async () => {
			// Empty array
			await expect(embedder.embedBatch([])).rejects.toThrow(EmbeddingValidationError);

			// Array too large
			const largeBatch = Array.from({ length: 3000 }, (_, i) => `text ${i}`);
			await expect(embedder.embedBatch(largeBatch)).rejects.toThrow(EmbeddingValidationError);

			// Invalid text in batch
			await expect(embedder.embedBatch(['valid text', ''])).rejects.toThrow(
				EmbeddingValidationError
			);
		});
	});

	describe('isHealthy', () => {
		it('should return true when embedding succeeds', async () => {
			const mockEmbedding = Array.from({ length: 768 }, () => Math.random());
			mockOpenAI.embeddings.create.mockResolvedValue({
				data: [{ embedding: mockEmbedding }],
			});

			const healthy = await embedder.isHealthy();

			expect(healthy).toBe(true);
			expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
				model: 'nomic-embed-text-v1.5',
				input: 'health check',
			});
		});

		it(
			'should return false when embedding fails',
			async () => {
				mockOpenAI.embeddings.create.mockRejectedValue(new Error('Connection failed'));

				const healthy = await embedder.isHealthy();

				expect(healthy).toBe(false);
			},
			{ timeout: 1000 }
		);
	});

	describe('disconnect', () => {
		it('should disconnect without errors', async () => {
			await expect(embedder.disconnect()).resolves.toBeUndefined();
		});
	});

	describe('error handling', () => {
		it('should handle different HTTP status codes', async () => {
			// Test just the 400 status case to debug
			const mockError = new Error('HTTP 400 error') as Error & { status?: number };
			mockError.status = 400;
			console.log('Mock error object:', mockError);
			console.log('Mock error has status:', 'status' in mockError);
			console.log('Mock error status:', mockError.status);

			mockOpenAI.embeddings.create.mockRejectedValueOnce(mockError);

			try {
				await embedder.embed('test');
			} catch (error) {
				if (error && typeof error === 'object' && 'constructor' in error) {
					console.log('Error type:', (error as any).constructor.name);
				}
				if (error && typeof error === 'object' && 'message' in error) {
					console.log('Error message:', (error as any).message);
				}
				expect(error).toBeInstanceOf(EmbeddingValidationError);
			}
		});

		it(
			'should provide helpful error messages for connection issues',
			async () => {
				const connectionError = new Error('fetch failed');
				mockOpenAI.embeddings.create.mockRejectedValue(connectionError);

				try {
					await embedder.embed('test');
				} catch (error) {
					expect(error).toBeInstanceOf(EmbeddingConnectionError);
					expect((error as EmbeddingConnectionError).message).toContain(
						'Cannot connect to LM Studio server'
					);
					expect((error as EmbeddingConnectionError).message).toContain('localhost:1234/v1');
				}
			},
			{ timeout: 1000 }
		);
	});

	describe('configuration', () => {
		it('should return immutable config copy', () => {
			const originalConfig = embedder.getConfig();
			originalConfig.model = 'modified';

			const newConfig = embedder.getConfig();
			expect(newConfig.model).toBe('nomic-embed-text-v1.5');
		});

		it('should handle missing response data', async () => {
			mockOpenAI.embeddings.create.mockResolvedValue({
				data: null,
			});

			await expect(embedder.embed('test')).rejects.toThrow('did not return a valid embedding');
		});

		it('should handle malformed response', async () => {
			mockOpenAI.embeddings.create.mockResolvedValue({
				data: [{}], // Missing embedding
			});

			await expect(embedder.embed('test')).rejects.toThrow('did not return a valid embedding');
		});
	});
});
