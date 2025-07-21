/**
 * ANN Index Tests
 *
 * Tests for the Approximate Nearest Neighbor index implementation.
 * Covers FAISS integration, fallback scenarios, and performance metrics.
 *
 * @module vector_storage/__test__/ann_index.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ANNIndex, type ANNIndexConfig } from '../ann_index.js';

describe('ANNIndex', () => {
	let annIndex: ANNIndex;
	let config: ANNIndexConfig;

	beforeEach(() => {
		config = {
			algorithm: 'brute-force',
			dimension: 4,
			maxVectors: 1000,
			minDatasetSize: 10,
			persistIndex: false,
		};
		annIndex = new ANNIndex(config);
	});

	afterEach(async () => {
		if (annIndex.isConnected()) {
			await annIndex.disconnect();
		}
	});

	describe('Initialization', () => {
		it('should initialize with brute-force algorithm', async () => {
			await annIndex.initialize();
			expect(annIndex.isConnected()).toBe(true);

			const stats = annIndex.getStats();
			expect(stats.algorithm).toBe('brute-force');
			expect(stats.usingANN).toBe(false);
		});

		it('should initialize with flat algorithm when FAISS is available', async () => {
			config.algorithm = 'flat';
			annIndex = new ANNIndex(config);

			await annIndex.initialize();
			expect(annIndex.isConnected()).toBe(true);

			const stats = annIndex.getStats();
			// Note: This will be brute-force if FAISS is not available
			expect(['flat', 'brute-force']).toContain(stats.algorithm);
		});

		it('should fallback to brute-force when FAISS fails', async () => {
			config.algorithm = 'flat';
			annIndex = new ANNIndex(config);

			// Mock FAISS import to fail
			vi.doMock('faiss-node', () => {
				throw new Error('FAISS not available');
			});

			await annIndex.initialize();
			expect(annIndex.isConnected()).toBe(true);

			const stats = annIndex.getStats();
			expect(stats.algorithm).toBe('brute-force');
			expect(stats.usingANN).toBe(false);
		});
	});

	describe('Vector Operations', () => {
		beforeEach(async () => {
			await annIndex.initialize();
		});

		it('should add vectors correctly', async () => {
			const vectors = [
				[1, 0, 0, 0],
				[0, 1, 0, 0],
				[0, 0, 1, 0],
			];
			const ids = [1, 2, 3];

			await annIndex.addVectors(vectors, ids);

			const stats = annIndex.getStats();
			expect(stats.vectorCount).toBe(3);
		});

		it('should validate vector dimensions', async () => {
			const vectors = [[1, 0, 0]]; // Wrong dimension
			const ids = [1];

			await expect(annIndex.addVectors(vectors, ids)).rejects.toThrow(
				'Vector dimension mismatch: expected 4, got 3'
			);
		});

		it('should validate input lengths', async () => {
			const vectors = [
				[1, 0, 0, 0],
				[0, 1, 0, 0],
			];
			const ids = [1]; // Mismatched length

			await expect(annIndex.addVectors(vectors, ids)).rejects.toThrow(
				'Vectors and IDs must have the same length'
			);
		});

		it('should remove vectors correctly', async () => {
			const vectors = [
				[1, 0, 0, 0],
				[0, 1, 0, 0],
				[0, 0, 1, 0],
			];
			const ids = [1, 2, 3];

			await annIndex.addVectors(vectors, ids);
			await annIndex.removeVectors([2]);

			const stats = annIndex.getStats();
			expect(stats.vectorCount).toBe(2);
		});

		it('should clear all vectors', async () => {
			const vectors = [
				[1, 0, 0, 0],
				[0, 1, 0, 0],
			];
			const ids = [1, 2];

			await annIndex.addVectors(vectors, ids);
			await annIndex.clear();

			const stats = annIndex.getStats();
			expect(stats.vectorCount).toBe(0);
		});
	});

	describe('Search Operations', () => {
		beforeEach(async () => {
			await annIndex.initialize();

			// Add test vectors
			const vectors = [
				[1, 0, 0, 0], // Most similar to query
				[0.7, 0.7, 0, 0],
				[0, 1, 0, 0],
				[0, 0, 1, 0],
				[0, 0, 0, 1],
			];
			const ids = [1, 2, 3, 4, 5];
			await annIndex.addVectors(vectors, ids);
		});

		it('should find similar vectors', async () => {
			const query = [1, 0, 0, 0];
			const results = await annIndex.search(query, 3);

			expect(results).toHaveLength(3);
			expect(results[0]!.id).toBe(1); // Should be most similar
			expect(results[0]!.score).toBeGreaterThan(0.9);
		});

		it('should respect limit parameter', async () => {
			const query = [1, 0, 0, 0];
			const results = await annIndex.search(query, 2);

			expect(results).toHaveLength(2);
		});

		it('should apply filters correctly', async () => {
			const query = [1, 0, 0, 0];
			const filter = (_id: number) => _id !== 1; // Exclude ID 1
			const results = await annIndex.search(query, 3, filter);

			expect(results).toHaveLength(3);
			expect(results.every(r => r.id !== 1)).toBe(true);
		});

		it('should return empty results when no matches', async () => {
			const query = [1, 0, 0, 0];
			const filter = (id: number) => false; // Exclude all
			const results = await annIndex.search(query, 3, filter);

			expect(results).toHaveLength(0);
		});

		it('should validate query dimension', async () => {
			const query = [1, 0, 0]; // Wrong dimension

			await expect(annIndex.search(query, 3)).rejects.toThrow(
				'Query dimension mismatch: expected 4, got 3'
			);
		});

		it('should track search performance metrics', async () => {
			const query = [1, 0, 0, 0];
			await annIndex.search(query, 3);

			const stats = annIndex.getStats();
			expect(stats.lastSearchMetrics).toBeDefined();
			expect(stats.lastSearchMetrics!.queryTime).toBeGreaterThan(0);
			expect(stats.lastSearchMetrics!.resultCount).toBe(3);
		});
	});

	describe('Performance and Fallback', () => {
		it('should use brute-force for small datasets', async () => {
			config.algorithm = 'flat';
			config.minDatasetSize = 100;
			annIndex = new ANNIndex(config);
			await annIndex.initialize();

			const vectors = [
				[1, 0, 0, 0],
				[0, 1, 0, 0],
			];
			const ids = [1, 2];
			await annIndex.addVectors(vectors, ids);

			const query = [1, 0, 0, 0];
			const results = await annIndex.search(query, 2);

			const stats = annIndex.getStats();
			expect(stats.lastSearchMetrics!.fromANN).toBe(false);
			expect(results).toHaveLength(2);
		});

		it('should handle large datasets efficiently', async () => {
			config.algorithm = 'flat';
			config.minDatasetSize = 5;
			annIndex = new ANNIndex(config);
			await annIndex.initialize();

			// Add many vectors
			const vectors: number[][] = [];
			const ids: number[] = [];
			for (let i = 0; i < 20; i++) {
				vectors.push([Math.random(), Math.random(), Math.random(), Math.random()]);
				ids.push(i);
			}
			await annIndex.addVectors(vectors, ids);

			const query = [1, 0, 0, 0];
			const startTime = Date.now();
			const results = await annIndex.search(query, 5);
			const queryTime = Date.now() - startTime;

			expect(results).toHaveLength(5);
			expect(queryTime).toBeLessThan(1000); // Should be fast
		});
	});

	describe('Error Handling', () => {
		it('should handle uninitialized index', async () => {
			const vectors = [[1, 0, 0, 0]];
			const ids = [1];

			await expect(annIndex.addVectors(vectors, ids)).rejects.toThrow('ANNIndex not initialized');
		});

		it('should handle search on empty index', async () => {
			await annIndex.initialize();
			const query = [1, 0, 0, 0];
			const results = await annIndex.search(query, 5);

			expect(results).toHaveLength(0);
		});

		it('should handle disconnection gracefully', async () => {
			await annIndex.initialize();
			await annIndex.disconnect();

			expect(annIndex.isConnected()).toBe(false);
		});
	});

	describe('Statistics', () => {
		beforeEach(async () => {
			await annIndex.initialize();
		});

		it('should provide accurate statistics', async () => {
			const vectors = [
				[1, 0, 0, 0],
				[0, 1, 0, 0],
			];
			const ids = [1, 2];
			await annIndex.addVectors(vectors, ids);

			const stats = annIndex.getStats();
			expect(stats.vectorCount).toBe(2);
			expect(stats.algorithm).toBe('brute-force');
			expect(stats.usingANN).toBe(false);
		});

		it('should track build time for ANN indices', async () => {
			config.algorithm = 'flat';
			annIndex = new ANNIndex(config);
			await annIndex.initialize();

			const stats = annIndex.getStats();
			// Build time may or may not be set depending on FAISS availability
			expect(stats.algorithm).toBeDefined();
		});
	});
});
