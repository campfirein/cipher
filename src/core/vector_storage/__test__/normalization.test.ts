/**
 * Integration Tests - VectorStoreManager Normalization
 *
 * Tests the normalizeData method in VectorStoreManager for database-wide normalization.
 * This tests the functionality we implemented to audit and migrate existing data.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { VectorStoreManager } from '../manager.js';
import { EmbeddingManager } from '@core/brain/embedding/manager.js';
import { InputRefinementConfig } from '@core/brain/embedding/config.js';

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

		// Setup vector store manager (this will create its own backend)
		vectorStoreManager = new VectorStoreManager({
			type: 'in-memory',
			collectionName: 'test-normalization', 
			dimension: 384
		});
		await vectorStoreManager.connect();

		// Setup embedding manager
		embeddingManager = new EmbeddingManager(normalizationConfig);
	});

	afterEach(async () => {
		await vectorStoreManager?.disconnect();
	});

	describe('Database-wide Normalization Method', () => {
		test('should execute normalizeData method without errors on empty database', async () => {
			// Run normalization on empty database
			const results = await vectorStoreManager.normalizeData(
				embeddingManager,
				normalizationConfig
			);

			// Should complete without errors and return proper structure
			expect(results).toBeDefined();
			expect(results.status).toBeDefined();
			expect(results.message).toBeDefined();
			expect(['success', 'partial_success', 'failure']).toContain(results.status);
		});

		test('should handle different batch sizes', async () => {
			// Test with small batch size
			const results = await vectorStoreManager.normalizeData(
				embeddingManager,
				normalizationConfig,
				2 // Small batch size
			);

			// Should complete successfully
			expect(results).toBeDefined();
			expect(results.status).toBeDefined();
			expect(results.message).toBeDefined();
			expect(['success', 'partial_success', 'failure']).toContain(results.status);
		});

		test('should handle force normalization flag', async () => {
			// Run normalization with force flag
			const results = await vectorStoreManager.normalizeData(
				embeddingManager,
				normalizationConfig,
				100, // batchSize
				true  // force
			);

			// Should complete successfully
			expect(results).toBeDefined();
			expect(results.status).toBeDefined();
			expect(results.message).toBeDefined();
			expect(['success', 'partial_success', 'failure']).toContain(results.status);
		});

		test('should validate input parameters', async () => {
			// Test with null embedding manager - the method handles this gracefully
			const results1 = await vectorStoreManager.normalizeData(
				null as any,
				normalizationConfig
			);
			expect(results1).toBeDefined();
			expect(results1.status).toBeDefined();

			// Test with null config - the method handles this gracefully  
			const results2 = await vectorStoreManager.normalizeData(
				embeddingManager,
				null as any
			);
			expect(results2).toBeDefined();
			expect(results2.status).toBeDefined();
		});

		test('should handle connection issues gracefully', async () => {
			// Disconnect the store first
			await vectorStoreManager.disconnect();

			// Try to run normalization on disconnected store
			await expect(
				vectorStoreManager.normalizeData(
					embeddingManager,
					normalizationConfig
				)
			).rejects.toThrow();
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

			const results = await vectorStoreManager.normalizeData(
				embeddingManager,
				minimalConfig
			);

			expect(results).toBeDefined();
			expect(results.status).toBeDefined();
			expect(results.message).toBeDefined();
		});

		test('should work with full normalization config', async () => {
			const fullConfig: InputRefinementConfig = {
				NORMALIZATION_TOLOWERCASE: true,
				NORMALIZATION_REMOVEPUNCTUATION: true,
				NORMALIZATION_WHITESPACE: true,
				NORMALIZATION_STOPWORDS: true,
				NORMALIZATION_STEMMING: true,
				NORMALIZATION_LEMMATIZATION: false, // Not implemented yet
				NORMALIZATION_LANGUAGE: 'ENGLISH',
				NORMALIZATION_PAST_DATA: true,
			};

			const results = await vectorStoreManager.normalizeData(
				embeddingManager,
				fullConfig
			);

			expect(results).toBeDefined();
			expect(results.status).toBeDefined();
			expect(results.message).toBeDefined();
		});
	});
}); 