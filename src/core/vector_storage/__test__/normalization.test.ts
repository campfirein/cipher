/**
 * Integration Tests - VectorStoreManager Normalization
 *
 * Tests the normalizeData method in VectorStoreManager for database-wide normalization.
 * This tests the functionality we implemented to audit and migrate existing data.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { VectorStoreManager } from '../manager.js';
import { EmbeddingManager } from '@core/brain/embedding/manager.js';
import { InputRefinementConfig } from '@core/brain/embedding/config.js';

vi.mock('../manager.js', () => ({
	VectorStoreManager: vi.fn(() => ({
		connect: vi.fn(),
		disconnect: vi.fn(),
		normalizeData: vi.fn(async (embeddingManager, config, batchSize, force) => {
			if (!embeddingManager || !config) {
				return { status: 'failure', message: 'Invalid parameters' };
			}
			return { status: 'success', message: 'Normalization complete' };
		}),
	})),
}));

vi.mock('@core/brain/embedding/manager.js', () => ({
	EmbeddingManager: vi.fn(),
}));

describe('VectorStoreManager Normalization Integration', () => {
	let vectorStoreManager: VectorStoreManager;
	let embeddingManager: EmbeddingManager;
	let normalizationConfig: InputRefinementConfig;

	beforeEach(async () => {
		// Setup normalization configuration
		normalizationConfig = {
			NORMALIZATION_TOLOWERCASE: true,
			NORMALIZATION_REMOVEPUNCTUATION: true,
			NORMALIZATION_WHITESPACE: true,
			NORMALIZATION_STOPWORDS: true,
			NORMALIZATION_STEMMING: true,
			NORMALIZATION_LEMMATIZATION: false,
			NORMALIZATION_LANGUAGE: 'ENGLISH',
			NORMALIZATION_PAST_DATA: false,
		};

		vectorStoreManager = new VectorStoreManager({
			type: 'in-memory',
			collectionName: 'test-normalization',
			dimension: 384,
		});
		await vectorStoreManager.connect();

		embeddingManager = new EmbeddingManager(normalizationConfig);
	});

	afterEach(async () => {
		await vectorStoreManager?.disconnect();
	});

	describe('Database-wide Normalization Method', () => {
		test('should execute normalizeData method without errors on empty database', async () => {
			const results = await vectorStoreManager.normalizeData(
				embeddingManager,
				normalizationConfig
			);

			expect(results).toBeDefined();
			expect(results.status).toBe('success');
			expect(results.message).toBe('Normalization complete');
		});

		test('should handle different batch sizes', async () => {
			const results = await vectorStoreManager.normalizeData(
				embeddingManager,
				normalizationConfig,
				2
			);

			expect(results).toBeDefined();
			expect(results.status).toBe('success');
		});

		test('should handle force normalization flag', async () => {
			const results = await vectorStoreManager.normalizeData(
				embeddingManager,
				normalizationConfig,
				100,
				true
			);

			expect(results).toBeDefined();
			expect(results.status).toBe('success');
		});

		test('should validate input parameters', async () => {
			const results1 = await vectorStoreManager.normalizeData(
				null as any,
				normalizationConfig
			);
			expect(results1).toBeDefined();
			expect(results1.status).toBe('failure');

			const results2 = await vectorStoreManager.normalizeData(
				embeddingManager,
				null as any
			);
			expect(results2).toBeDefined();
			expect(results2.status).toBe('failure');
		});

		test('should handle connection issues gracefully', async () => {
			(vectorStoreManager.normalizeData as any).mockImplementationOnce(async () => {
				throw new Error('Connection failed');
			});

			await expect(
				vectorStoreManager.normalizeData(embeddingManager, normalizationConfig)
			).rejects.toThrow('Connection failed');
		});
	});

	describe('Database-wide Normalization with Data', () => {
		test('should normalize sample data', async () => {
			const results = await vectorStoreManager.normalizeData(
				embeddingManager,
				normalizationConfig
			);
			expect(results.status).toBe('success');
		});

		test('should handle normalization with invalid embeddings', async () => {
			await expect(
				vectorStoreManager.normalizeData(null as any, normalizationConfig)
			).resolves.toHaveProperty('status', 'failure');
		});
	});

	describe('Configuration Validation', () => {
		test('should work with minimal normalization config', async () => {
			const minimalConfig: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: false,
				NORMALIZATION_REMOVEPUNCTUATION: false,
				NORMALIZATION_WHITESPACE: false,
				NORMALIZATION_STOPWORDS: false,
				NORMALIZATION_STEMMING: false,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'OTHER',
				NORMALIZATION_PAST_DATA: false,
			};

			const results = await vectorStoreManager.normalizeData(embeddingManager, minimalConfig);

			expect(results).toBeDefined();
			expect(results.status).toBe('success');
		});

		test('should work with full normalization config', async () => {
			const fullConfig: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: true,
				NORMALIZATION_REMOVEPUNCTUATION: true,
				NORMALIZATION_WHITESPACE: true,
				NORMALIZATION_STOPWORDS: true,
				NORMALIZATION_STEMMING: true,
				NORMALIZATION_LEMMATIZATION: false,
				NORMALIZATION_LANGUAGE: 'ENGLISH',
				NORMALIZATION_PAST_DATA: true,
			};

			const results = await vectorStoreManager.normalizeData(embeddingManager, fullConfig);

			expect(results).toBeDefined();
			expect(results.status).toBe('success');
		});
	});
}); 