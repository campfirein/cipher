/**
 * Integration Tests for Qdrant Backend with Normalization
 *
 * This test file ensures that the Qdrant vector store backend works correctly
 * with the new normalization features. It verifies that data can be inserted,
 * normalized, and retrieved as expected.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { EmbeddingManager } from '@core/brain/embedding/manager.js';
import { InputRefinementConfig } from '@core/brain/embedding/config.js';
import { VectorStoreManager } from '../manager.js';

// Mock the QdrantBackend module
const mockQdrantInstance = {
	connect: vi.fn().mockResolvedValue(undefined),
	disconnect: vi.fn().mockResolvedValue(undefined),
	list: vi.fn(), // We will configure this in the test
	update: vi.fn().mockResolvedValue(undefined),
	isConnected: vi.fn().mockReturnValue(true),
};
vi.mock('../backend/qdrant.js', () => ({
	QdrantBackend: vi.fn(() => mockQdrantInstance),
}));

// Mock the EmbeddingManager
vi.mock('@core/brain/embedding/manager.js', () => ({
	EmbeddingManager: vi.fn(() => ({
		embed: vi.fn().mockResolvedValue([0.4, 0.5, 0.6]),
	})),
}));

describe('Qdrant Backend Normalization Integration', () => {
	let manager: VectorStoreManager;
	let embeddingManager: EmbeddingManager;
	let normalizationConfig: InputRefinementConfig;

	beforeEach(async () => {
		vi.clearAllMocks(); // Clear mocks before each test
		normalizationConfig = {
			NORMALIZATION_TOLOWERCASE: true,
			NORMALIZATION_REMOVEPUNCTUATION: true,
			NORMALIZATION_WHITESPACE: true,
			NORMALIZATION_STOPWORDS: false,
			NORMALIZATION_STEMMING: false,
			NORMALIZATION_LEMMATIZATION: false,
			NORMALIZATION_LANGUAGE: 'ENGLISH',
			NORMALIZATION_PAST_DATA: false,
		};

		embeddingManager = new EmbeddingManager(normalizationConfig);
		manager = new VectorStoreManager({
			type: 'qdrant', // This will use the mocked QdrantBackend
			url: 'http://mock-qdrant:6333',
			collectionName: 'test-qdrant-normalization',
			dimension: 3,
		});

		await manager.connect();
	});

	afterEach(async () => {
		await manager?.disconnect();
	});

	test('should successfully run normalization and skip already normalized items', async () => {
		// Setup pagination mock
		mockQdrantInstance.list
			.mockResolvedValueOnce([
				// First page
				[{ id: '1', payload: { content: 'Test Content' } }],
				'page2', // Next page cursor
			])
			.mockResolvedValueOnce([
				// Second page
				[{ id: '2', payload: { content: 'already normalized'} }],
				null, // No more pages
			]);

		const results = await manager.normalizeData(
			embeddingManager,
			normalizationConfig
		);

		expect(results).toBeDefined();
		expect(results.status).toBe('success');
		expect(results.updated).toBe(1); // One item updated
		expect(results.skipped).toBe(1); // One item skipped
		expect(results.failed).toBe(0);

		// Verify that the backend's list and update methods were called
		expect(mockQdrantInstance.list).toHaveBeenCalledTimes(2);
		expect(mockQdrantInstance.update).toHaveBeenCalledTimes(1);
	});
}); 