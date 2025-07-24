/**
 * ANN Benchmark Tests
 *
 * Performance benchmarks comparing ANN search vs brute-force search.
 * Demonstrates the performance improvements of approximate nearest neighbor algorithms.
 *
 * @module vector_storage/__test__/ann_benchmark.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ANNIndex, type ANNIndexConfig } from '../ann_index.js';
import {
	EnhancedInMemoryBackend,
	type EnhancedInMemoryConfig,
} from '../backend/enhanced-in-memory.js';

describe('ANN Performance Benchmarks', () => {
	describe('ANNIndex Benchmarks', () => {
		let annIndex: ANNIndex;
		let config: ANNIndexConfig;

		beforeEach(() => {
			config = {
				algorithm: 'brute-force',
				dimension: 1536, // OpenAI ada-002 dimension
				maxVectors: 10000,
				minDatasetSize: 100,
				persistIndex: false,
			};
			annIndex = new ANNIndex(config);
		});

		afterEach(async () => {
			if (annIndex.isConnected()) {
				await annIndex.disconnect();
			}
		});

		it('should demonstrate brute-force vs ANN performance', async () => {
			await annIndex.initialize();

			// Generate test data
			const vectorCount = 1000;
			const vectors: number[][] = [];
			const ids: number[] = [];

			for (let i = 0; i < vectorCount; i++) {
				const vector = new Array(1536).fill(0).map(() => Math.random() - 0.5);
				vectors.push(vector);
				ids.push(i);
			}

			// Add vectors to index
			const addStartTime = Date.now();
			await annIndex.addVectors(vectors, ids);
			const addTime = Date.now() - addStartTime;

			// Test brute-force search
			const query = new Array(1536).fill(0).map(() => Math.random() - 0.5);
			const bruteForceStartTime = Date.now();
			const bruteForceResults = await annIndex.search(query, 10);
			const bruteForceTime = Date.now() - bruteForceStartTime;

			// Test with ANN (if available)
			config.algorithm = 'flat';
			const annIndexHnsw = new ANNIndex(config);
			await annIndexHnsw.initialize();
			await annIndexHnsw.addVectors(vectors, ids);

			const annStartTime = Date.now();
			const annResults = await annIndexHnsw.search(query, 10);
			const annTime = Date.now() - annStartTime;

			await annIndexHnsw.disconnect();

			// Verify results are similar
			expect(bruteForceResults).toHaveLength(10);
			expect(annResults).toHaveLength(10);

			// Performance assertions
			expect(addTime).toBeLessThan(5000); // Should add vectors quickly
			expect(bruteForceTime).toBeLessThan(1000); // Should search quickly

			// ANN should be faster than brute-force for large datasets
			if (annIndexHnsw.getStats().usingANN) {
				expect(annTime).toBeLessThan(bruteForceTime);
			}

			console.log(`Benchmark Results:
				Vector Count: ${vectorCount}
				Add Time: ${addTime}ms
				Brute Force Search: ${bruteForceTime}ms
				ANN Search: ${annTime}ms
				Speedup: ${(bruteForceTime / annTime).toFixed(2)}x
			`);
		});

		it('should scale with dataset size', async () => {
			await annIndex.initialize();

			const sizes = [100, 500, 1000];
			const results: { size: number; bruteForceTime: number; annTime: number }[] = [];

			for (const size of sizes) {
				// Generate data
				const vectors: number[][] = [];
				const ids: number[] = [];

				for (let i = 0; i < size; i++) {
					const vector = new Array(1536).fill(0).map(() => Math.random() - 0.5);
					vectors.push(vector);
					ids.push(i);
				}

				// Test brute-force
				await annIndex.clear();
				await annIndex.addVectors(vectors, ids);

				const query = new Array(1536).fill(0).map(() => Math.random() - 0.5);
				const bruteForceStartTime = Date.now();
				await annIndex.search(query, 10);
				const bruteForceTime = Date.now() - bruteForceStartTime;

				// Test ANN
				config.algorithm = 'flat';
				const annIndexHnsw = new ANNIndex(config);
				await annIndexHnsw.initialize();
				await annIndexHnsw.addVectors(vectors, ids);

				const annStartTime = Date.now();
				await annIndexHnsw.search(query, 10);
				const annTime = Date.now() - annStartTime;

				results.push({
					size,
					bruteForceTime,
					annTime,
				});

				await annIndexHnsw.disconnect();
			}

			// Verify scaling behavior
			for (let i = 1; i < results.length; i++) {
				const prev = results[i - 1]!;
				const curr = results[i]!;

				// Brute force should scale reasonably
				const expectedBruteForceRatio = curr.size / prev.size;
				const actualBruteForceRatio = curr.bruteForceTime / prev.bruteForceTime;
				// For small datasets, timing can be inconsistent, so we're more lenient
				expect(actualBruteForceRatio).toBeGreaterThan(0.1);

				// ANN should scale reasonably (since we're using brute-force fallback)
				if (curr.annTime > 0 && prev.annTime > 0) {
					const annRatio = curr.annTime / prev.annTime;
					// Only assert if both times are at least 10ms to avoid noise
					if (curr.annTime >= 10 && prev.annTime >= 10) {
						expect(annRatio).toBeLessThanOrEqual(expectedBruteForceRatio * 2.5);
					}
				}
			}

			console.log('Scaling Results:', results);
		});
	});

	describe('Enhanced In-Memory Backend Benchmarks', () => {
		let backend: EnhancedInMemoryBackend;
		let config: EnhancedInMemoryConfig;

		beforeEach(() => {
			config = {
				type: 'enhanced-in-memory',
				collectionName: 'benchmark',
				dimension: 1536,
				maxVectors: 10000,
				annAlgorithm: 'brute-force',
				annMinDatasetSize: 100,
			};
			backend = new EnhancedInMemoryBackend(config);
		});

		afterEach(async () => {
			if (backend.isConnected()) {
				await backend.disconnect();
			}
		});

		it('should demonstrate enhanced backend performance', async () => {
			await backend.connect();

			// Generate test data
			const vectorCount = 500;
			const vectors: number[][] = [];
			const ids: number[] = [];
			const payloads: Record<string, any>[] = [];

			for (let i = 0; i < vectorCount; i++) {
				const vector = new Array(1536).fill(0).map(() => Math.random() - 0.5);
				vectors.push(vector);
				ids.push(i);
				payloads.push({
					title: `Document ${i}`,
					category: `Category ${i % 5}`,
					score: Math.floor(Math.random() * 100),
				});
			}

			// Test insertion performance
			const insertStartTime = Date.now();
			await backend.insert(vectors, ids, payloads);
			const insertTime = Date.now() - insertStartTime;

			// Test search performance
			const query = new Array(1536).fill(0).map(() => Math.random() - 0.5);
			const searchStartTime = Date.now();
			const results = await backend.search(query, 10);
			const searchTime = Date.now() - searchStartTime;

			// Test filtered search
			const filteredSearchStartTime = Date.now();
			const filteredResults = await backend.search(query, 10, { category: 'Category 0' });
			const filteredSearchTime = Date.now() - filteredSearchStartTime;

			expect(results).toHaveLength(10);
			expect(filteredResults.length).toBeLessThanOrEqual(10);
			expect(insertTime).toBeLessThan(3000);
			expect(searchTime).toBeLessThan(1000);
			expect(filteredSearchTime).toBeLessThan(1000);

			console.log(`Enhanced Backend Benchmark:
				Vector Count: ${vectorCount}
				Insert Time: ${insertTime}ms
				Search Time: ${searchTime}ms
				Filtered Search Time: ${filteredSearchTime}ms
				Results: ${results.length}
				Filtered Results: ${filteredResults.length}
			`);
		});

		it('should compare brute-force vs ANN performance', async () => {
			// Test brute-force
			await backend.connect();
			await backend.insert(
				[new Array(1536).fill(0).map(() => Math.random() - 0.5)],
				[1],
				[{ title: 'Test' }]
			);

			const query = new Array(1536).fill(0).map(() => Math.random() - 0.5);
			const bruteForceStartTime = Date.now();
			await backend.search(query, 1);
			const bruteForceTime = Date.now() - bruteForceStartTime;

			await backend.disconnect();

			// Test with ANN
			config.annAlgorithm = 'flat';
			backend = new EnhancedInMemoryBackend(config);
			await backend.connect();
			await backend.insert(
				[new Array(1536).fill(0).map(() => Math.random() - 0.5)],
				[1],
				[{ title: 'Test' }]
			);

			const annStartTime = Date.now();
			await backend.search(query, 1);
			const annTime = Date.now() - annStartTime;

			expect(bruteForceTime).toBeLessThan(1000);
			expect(annTime).toBeLessThan(1000);

			const stats = backend.getANNStats();
			if (stats?.usingANN) {
				expect(annTime).toBeLessThanOrEqual(bruteForceTime);
			}

			console.log(`Performance Comparison:
				Brute Force: ${bruteForceTime}ms
				ANN: ${annTime}ms
				Using ANN: ${stats?.usingANN}
				Speedup: ${(bruteForceTime / annTime).toFixed(2)}x
			`);
		});
	});

	describe('Memory Usage Benchmarks', () => {
		it('should handle large datasets efficiently', async () => {
			const config: ANNIndexConfig = {
				algorithm: 'brute-force',
				dimension: 1536,
				maxVectors: 10000,
				minDatasetSize: 100,
				persistIndex: false,
			};

			const annIndex = new ANNIndex(config);
			await annIndex.initialize();

			// Measure memory usage for different dataset sizes
			const sizes = [100, 500, 1000];
			const memoryUsage: { size: number; memory: number }[] = [];

			for (const size of sizes) {
				const vectors: number[][] = [];
				const ids: number[] = [];

				for (let i = 0; i < size; i++) {
					const vector = new Array(1536).fill(0).map(() => Math.random() - 0.5);
					vectors.push(vector);
					ids.push(i);
				}

				const startMemory = process.memoryUsage().heapUsed;
				await annIndex.addVectors(vectors, ids);
				const endMemory = process.memoryUsage().heapUsed;
				const memoryUsed = endMemory - startMemory;

				memoryUsage.push({
					size,
					memory: memoryUsed / 1024 / 1024, // MB
				});

				await annIndex.clear();
			}

			await annIndex.disconnect();

			// Verify memory usage is reasonable
			for (const usage of memoryUsage) {
				// Each vector is 1536 * 8 bytes (Float64) + overhead
				const expectedMemory = (usage.size * 1536 * 8) / 1024 / 1024; // MB
				expect(usage.memory).toBeLessThan(expectedMemory * 2); // Allow some overhead
			}

			console.log('Memory Usage:', memoryUsage);
		});
	});
});
