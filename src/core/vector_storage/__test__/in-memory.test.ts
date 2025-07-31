/**
 * In-Memory Vector Storage Backend Tests
 *
 * Tests for the in-memory vector storage backend implementation.
 * Verifies vector operations, similarity search, and metadata handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryBackend } from '../backend/in-memory.js';
import { VectorStoreError, VectorDimensionError } from '../backend/types.js';
import { BACKEND_TYPES } from '../constants.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock the logger to reduce noise in tests
vi.mock('../../logger/index.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

describe('InMemoryBackend with Persistence', () => {
	let backend: InMemoryBackend;
	const testDir = './test-data';

	const validConfig = {
		type: 'in-memory' as const,
		collectionName: 'test_collection',
		dimension: 3,
		maxVectors: 100,
		annPersistIndex: true,
		annIndexPath: testDir,
	};

	beforeEach(async () => {
		await fs.mkdir(testDir, { recursive: true });
		backend = new InMemoryBackend(validConfig);
	});

	afterEach(async () => {
		if (backend.isConnected()) {
			await backend.disconnect();
		}
		await fs.rm(testDir, { recursive: true, force: true });
	});

	describe('Connection and Persistence', () => {
		it('should connect, create persistence files, and disconnect', async () => {
			await backend.connect();
			expect(backend.isConnected()).toBe(true);

			await backend.disconnect();
			expect(backend.isConnected()).toBe(false);

			const files = await fs.readdir(testDir);
			expect(files).toContain('ann_index.faiss');
			expect(files).toContain('payloads.json');
		});

		it('should load a persisted index', async () => {
			// First, create and persist an index
			const initialBackend = new InMemoryBackend(validConfig);
			await initialBackend.connect();
			await initialBackend.insert(
				[
					[1, 2, 3],
					[4, 5, 6],
				],
				[1, 2],
				[{ title: 'First' }, { title: 'Second' }]
			);
			await initialBackend.disconnect();

			// Now, create a new backend and connect to the same path
			const newBackend = new InMemoryBackend(validConfig);
			await newBackend.connect();

			const result = await newBackend.get(1);
			expect(result).not.toBeNull();
			expect(result!.payload).toEqual({ title: 'First' });

			const searchResults = await newBackend.search([1, 2, 3], 1);
			expect(searchResults).toHaveLength(1);
			expect(searchResults[0]!.id).toBe(1);
		});
	});

	describe('Vector Operations', () => {
		beforeEach(async () => {
			await backend.connect();
		});

		it('should insert and retrieve vectors', async () => {
			const vectors = [
				[1, 2, 3],
				[4, 5, 6],
			];
			const ids = [1, 2];
			const payloads = [{ title: 'First' }, { title: 'Second' }];

			await backend.insert(vectors, ids, payloads);

			const result1 = await backend.get(1);
			expect(result1).toBeTruthy();
			expect(result1!.id).toBe(1);
			expect(result1!.payload).toEqual({ title: 'First' });

			const result2 = await backend.get(2);
			expect(result2).toBeTruthy();
			expect(result2!.id).toBe(2);
			expect(result2!.payload).toEqual({ title: 'Second' });
		});

		it('should update vectors and payloads', async () => {
			await backend.insert([[1, 2, 3]], [1], [{ title: 'Original' }]);

			await backend.update(1, [7, 8, 9], { title: 'Updated' });

			const result = await backend.get(1);
			expect(result!.payload).toEqual({ title: 'Updated' });

			// Verify that the search returns the updated vector
			const searchResults = await backend.search([7, 8, 9], 1);
			expect(searchResults[0]!.id).toBe(1);
		});

		it('should delete vectors and payloads', async () => {
			await backend.insert([[1, 2, 3]], [1], [{ title: 'Test' }]);
			let result = await backend.get(1);
			expect(result).not.toBeNull();

			await backend.delete(1);

			result = await backend.get(1);
			expect(result).toBeNull();
		});
	});

	describe('Similarity Search', () => {
		beforeEach(async () => {
			await backend.connect();
			const vectors = [
				[1, 0, 0],
				[0.9, 0.1, 0],
				[0, 1, 0],
				[0, 0.9, 0.1],
				[0, 0, 1],
			];
			const ids = [1, 2, 3, 4, 5];
			const payloads = [
				{ category: 'A' },
				{ category: 'A' },
				{ category: 'B' },
				{ category: 'B' },
				{ category: 'C' },
			];
			await backend.insert(vectors, ids, payloads);
		});

		it('should return most similar vectors', async () => {
			const query = [1, 0, 0];
			const results = await backend.search(query, 2);
			expect(results.map(r => r.id)).toEqual([1, 2]);
		});

		it('should filter by metadata', async () => {
			const query = [0, 1, 0];
			const results = await backend.search(query, 5, { category: 'B' });
			expect(results.map(r => r.id)).toEqual([3, 4]);
		});
	});
});
