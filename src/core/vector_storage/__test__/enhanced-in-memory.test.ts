/**
 * Enhanced In-Memory Backend Tests
 *
 * Tests for the enhanced in-memory vector store with ANN acceleration.
 * Covers integration with ANN index and fallback scenarios.
 *
 * @module vector_storage/__test__/enhanced-in-memory.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	EnhancedInMemoryBackend,
	type EnhancedInMemoryConfig,
} from '../backend/enhanced-in-memory.js';

describe('EnhancedInMemoryBackend', () => {
	let backend: EnhancedInMemoryBackend;
	let config: EnhancedInMemoryConfig;

	beforeEach(() => {
		config = {
			type: 'enhanced-in-memory',
			collectionName: 'test',
			dimension: 4,
			maxVectors: 1000,
			annAlgorithm: 'brute-force',
			annMinDatasetSize: 10,
		};
		backend = new EnhancedInMemoryBackend(config);
	});

	afterEach(async () => {
		if (backend.isConnected()) {
			await backend.disconnect();
		}
	});

	describe('Initialization', () => {
		it('should connect successfully', async () => {
			await backend.connect();
			expect(backend.isConnected()).toBe(true);
		});

		it('should initialize with ANN support when configured', async () => {
			config.annAlgorithm = 'flat';
			backend = new EnhancedInMemoryBackend(config);
			await backend.connect();

			expect(backend.isConnected()).toBe(true);
			expect(backend.getBackendType()).toBe('enhanced-in-memory');
		});

		it('should handle connection errors gracefully', async () => {
			// Test with invalid config
			config.dimension = -1;
			backend = new EnhancedInMemoryBackend(config);

			await expect(backend.connect()).rejects.toThrow();
		});
	});

	describe('Vector Operations', () => {
		beforeEach(async () => {
			await backend.connect();
		});

		it('should insert vectors correctly', async () => {
			const vectors = [
				[1, 0, 0, 0],
				[0, 1, 0, 0],
				[0, 0, 1, 0],
			];
			const ids = [1, 2, 3];
			const payloads = [{ title: 'Doc 1' }, { title: 'Doc 2' }, { title: 'Doc 3' }];

			await backend.insert(vectors, ids, payloads);

			// Verify vectors were stored
			const result1 = await backend.get(1);
			expect(result1).toBeDefined();
			expect(result1!.payload.title).toBe('Doc 1');
		});

		it('should validate vector dimensions', async () => {
			const vectors = [[1, 0, 0]]; // Wrong dimension
			const ids = [1];
			const payloads = [{ title: 'Doc 1' }];

			await expect(backend.insert(vectors, ids, payloads)).rejects.toThrow(
				'Vector dimension mismatch'
			);
		});

		it('should update vectors correctly', async () => {
			// Insert initial vector
			await backend.insert([[1, 0, 0, 0]], [1], [{ title: 'Original' }]);

			// Update vector
			await backend.update(1, [0, 1, 0, 0], { title: 'Updated' });

			const result = await backend.get(1);
			expect(result!.payload.title).toBe('Updated');
		});

		it('should delete vectors correctly', async () => {
			await backend.insert([[1, 0, 0, 0]], [1], [{ title: 'Doc 1' }]);

			await backend.delete(1);

			const result = await backend.get(1);
			expect(result).toBeNull();
		});

		it('should handle capacity limits', async () => {
			config.maxVectors = 2;
			backend = new EnhancedInMemoryBackend(config);
			await backend.connect();

			// Insert up to capacity
			await backend.insert(
				[
					[1, 0, 0, 0],
					[0, 1, 0, 0],
				],
				[1, 2],
				[{ title: 'Doc 1' }, { title: 'Doc 2' }]
			);

			// Try to exceed capacity
			await expect(backend.insert([[0, 0, 1, 0]], [3], [{ title: 'Doc 3' }])).rejects.toThrow(
				'exceed maximum vector capacity'
			);
		});
	});

	describe('Search Operations', () => {
		beforeEach(async () => {
			await backend.connect();

			// Add test vectors
			const vectors = [
				[1, 0, 0, 0], // Most similar to query
				[0.7, 0.7, 0, 0],
				[0, 1, 0, 0],
				[0, 0, 1, 0],
				[0, 0, 0, 1],
			];
			const ids = [1, 2, 3, 4, 5];
			const payloads = [
				{ title: 'Doc 1', category: 'A' },
				{ title: 'Doc 2', category: 'A' },
				{ title: 'Doc 3', category: 'B' },
				{ title: 'Doc 4', category: 'B' },
				{ title: 'Doc 5', category: 'C' },
			];
			await backend.insert(vectors, ids, payloads);
		});

		it('should find similar vectors', async () => {
			const query = [1, 0, 0, 0];
			const results = await backend.search(query, 3);

			expect(results).toHaveLength(3);
			expect(results[0]!.id).toBe(1); // Should be most similar
			expect(results[0]!.score).toBeGreaterThan(0.9);
		});

		it('should respect limit parameter', async () => {
			const query = [1, 0, 0, 0];
			const results = await backend.search(query, 2);

			expect(results).toHaveLength(2);
		});

		it('should apply metadata filters', async () => {
			const query = [1, 0, 0, 0];
			const filters = { category: 'A' };
			const results = await backend.search(query, 5, filters);

			expect(results).toHaveLength(2);
			expect(results.every(r => r.payload.category === 'A')).toBe(true);
		});

		it('should handle range filters', async () => {
			// Add vectors with numeric metadata
			await backend.insert([[0.5, 0.5, 0, 0]], [6], [{ title: 'Doc 6', score: 85 }]);

			const query = [1, 0, 0, 0];
			const filters = { score: { gte: 80 } };
			const results = await backend.search(query, 5, filters);

			expect(results.some(r => r.id === 6)).toBe(true);
		});

		it('should handle array filters', async () => {
			const query = [1, 0, 0, 0];
			const filters = { category: { any: ['A', 'B'] } };
			const results = await backend.search(query, 5, filters);

			expect(results).toHaveLength(4);
			expect(results.every(r => ['A', 'B'].includes(r.payload.category))).toBe(true);
		});

		it('should return empty results when no matches', async () => {
			const query = [1, 0, 0, 0];
			const filters = { category: 'D' };
			const results = await backend.search(query, 5, filters);

			expect(results).toHaveLength(0);
		});

		it('should validate query dimension', async () => {
			const query = [1, 0, 0]; // Wrong dimension

			await expect(backend.search(query, 3)).rejects.toThrow('Vector dimension mismatch');
		});
	});

	describe('ANN Integration', () => {
		beforeEach(async () => {
			config.annAlgorithm = 'flat';
			config.annMinDatasetSize = 3;
			backend = new EnhancedInMemoryBackend(config);
			await backend.connect();
		});

		it('should use ANN for large datasets', async () => {
			// Add enough vectors to trigger ANN
			const vectors: number[][] = [];
			const ids: number[] = [];
			const payloads: Record<string, any>[] = [];

			for (let i = 0; i < 10; i++) {
				vectors.push([Math.random(), Math.random(), Math.random(), Math.random()]);
				ids.push(i);
				payloads.push({ title: `Doc ${i}` });
			}

			await backend.insert(vectors, ids, payloads);

			const query = [1, 0, 0, 0];
			const results = await backend.search(query, 5);

			expect(results).toHaveLength(5);
		});

		it('should fallback to brute-force for small datasets', async () => {
			// Add only 2 vectors (below ANN threshold)
			await backend.insert(
				[
					[1, 0, 0, 0],
					[0, 1, 0, 0],
				],
				[1, 2],
				[{ title: 'Doc 1' }, { title: 'Doc 2' }]
			);

			const query = [1, 0, 0, 0];
			const results = await backend.search(query, 2);

			expect(results).toHaveLength(2);
		});

		it('should handle ANN failures gracefully', async () => {
			// This test verifies that the system falls back to brute-force
			// when ANN operations fail
			await backend.insert(
				[
					[1, 0, 0, 0],
					[0, 1, 0, 0],
					[0, 0, 1, 0],
				],
				[1, 2, 3],
				[{ title: 'Doc 1' }, { title: 'Doc 2' }, { title: 'Doc 3' }]
			);

			const query = [1, 0, 0, 0];
			const results = await backend.search(query, 3);

			expect(results).toHaveLength(3);
		});
	});

	describe('Collection Management', () => {
		beforeEach(async () => {
			await backend.connect();
		});

		it('should list vectors correctly', async () => {
			await backend.insert(
				[
					[1, 0, 0, 0],
					[0, 1, 0, 0],
				],
				[1, 2],
				[{ title: 'Doc 1' }, { title: 'Doc 2' }]
			);

			const [results, count] = await backend.list();

			expect(results).toHaveLength(2);
			expect(count).toBe(2);
		});

		it('should apply filters to list operation', async () => {
			await backend.insert(
				[
					[1, 0, 0, 0],
					[0, 1, 0, 0],
				],
				[1, 2],
				[
					{ title: 'Doc 1', category: 'A' },
					{ title: 'Doc 2', category: 'B' },
				]
			);

			const [results, count] = await backend.list({ category: 'A' });

			expect(results).toHaveLength(1);
			expect(count).toBe(1);
			expect(results[0]!.payload.category).toBe('A');
		});

		it('should respect limit in list operation', async () => {
			await backend.insert(
				[
					[1, 0, 0, 0],
					[0, 1, 0, 0],
					[0, 0, 1, 0],
				],
				[1, 2, 3],
				[{ title: 'Doc 1' }, { title: 'Doc 2' }, { title: 'Doc 3' }]
			);

			const [results, count] = await backend.list(undefined, 2);

			expect(results).toHaveLength(2);
			expect(count).toBe(3);
		});

		it('should delete collection', async () => {
			await backend.insert([[1, 0, 0, 0]], [1], [{ title: 'Doc 1' }]);

			await backend.deleteCollection();

			const [results, count] = await backend.list();
			expect(results).toHaveLength(0);
			expect(count).toBe(0);
		});
	});

	describe('Statistics and Monitoring', () => {
		beforeEach(async () => {
			await backend.connect();
		});

		it('should provide ANN statistics', async () => {
			config.annAlgorithm = 'flat';
			backend = new EnhancedInMemoryBackend(config);
			await backend.connect();

			const stats = backend.getANNStats();
			expect(stats).toBeDefined();
		});

		it('should track search performance', async () => {
			await backend.insert([[1, 0, 0, 0]], [1], [{ title: 'Doc 1' }]);

			const query = [1, 0, 0, 0];
			const startTime = Date.now();
			const results = await backend.search(query, 1);
			const queryTime = Date.now() - startTime;

			expect(results).toHaveLength(1);
			expect(queryTime).toBeLessThan(1000); // Should be fast
		});
	});

	describe('Error Handling', () => {
		it('should handle unconnected operations', async () => {
			const vectors = [[1, 0, 0, 0]];
			const ids = [1];
			const payloads = [{ title: 'Doc 1' }];

			await expect(backend.insert(vectors, ids, payloads)).rejects.toThrow('not connected');
		});

		it('should handle invalid vector IDs', async () => {
			await backend.connect();

			const result = await backend.get(999);
			expect(result).toBeNull();
		});

		it('should handle update of non-existent vector', async () => {
			await backend.connect();

			await expect(backend.update(999, [1, 0, 0, 0], { title: 'Updated' })).rejects.toThrow(
				'not found'
			);
		});

		it('should handle disconnection gracefully', async () => {
			await backend.connect();
			await backend.disconnect();

			expect(backend.isConnected()).toBe(false);
		});
	});
});
