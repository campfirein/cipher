/**
 * Milvus Vector Storage Backend Tests
 *
 * Tests for the Milvus vector storage backend implementation.
 * Uses mocking since Milvus requires external service.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MilvusBackend } from '../backend/milvus.js';
import {
	VectorStoreError,
	VectorStoreConnectionError,
	VectorDimensionError,
} from '../backend/types.js';

// Mock the Milvus client
const mockMilvusClient = {
	showCollections: vi.fn(),
	createCollection: vi.fn(),
	dropCollection: vi.fn(),
	createIndex: vi.fn(),
	loadCollection: vi.fn(),
	insert: vi.fn(),
	upsert: vi.fn(),
	query: vi.fn(),
	search: vi.fn(),
	deleteEntities: vi.fn(),
	describeIndex: vi.fn(),
};

vi.mock('@zilliz/milvus2-sdk-node', () => ({
	MilvusClient: vi.fn(() => mockMilvusClient),
	DataType: { VarChar: 'VarChar', FloatVector: 'FloatVector', JSON: 'JSON' },
}));

// Mock the logger to reduce noise in tests
vi.mock('../../logger/index.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

describe('MilvusBackend', () => {
	let backend: MilvusBackend;

	const validConfig = {
		type: 'milvus' as const,
		host: 'localhost',
		port: 19530,
		collectionName: 'test_collection',
		dimension: 3,
	};

	beforeEach(() => {
		backend = new MilvusBackend(validConfig);
		vi.clearAllMocks();
	});

	afterEach(async () => {
		if (backend.isConnected()) {
			await backend.disconnect();
		}
	});

	describe('Connection Management', () => {
		it('should connect successfully when collection exists', async () => {
			mockMilvusClient.showCollections.mockResolvedValue({ data: [{ name: 'test_collection' }] });
			mockMilvusClient.describeIndex.mockResolvedValue({
				index_descriptions: [{ index_name: 'vector_index' }],
			});
			mockMilvusClient.loadCollection.mockResolvedValue({});

			expect(backend.isConnected()).toBe(false);
			await backend.connect();
			expect(backend.isConnected()).toBe(true);
			expect(mockMilvusClient.showCollections).toHaveBeenCalled();
			expect(mockMilvusClient.describeIndex).toHaveBeenCalledWith({
				collection_name: 'test_collection',
				field_name: 'vector',
			});
			expect(mockMilvusClient.loadCollection).toHaveBeenCalled();
		});

		it('should create missing indexes for existing collection', async () => {
			mockMilvusClient.showCollections.mockResolvedValue({ data: [{ name: 'test_collection' }] });
			mockMilvusClient.describeIndex.mockResolvedValue({ index_descriptions: [] });
			mockMilvusClient.createIndex.mockResolvedValue({});
			mockMilvusClient.loadCollection.mockResolvedValue({});

			await backend.connect();

			expect(mockMilvusClient.showCollections).toHaveBeenCalled();
			expect(mockMilvusClient.describeIndex).toHaveBeenCalledWith({
				collection_name: 'test_collection',
				field_name: 'vector',
			});
			expect(mockMilvusClient.createIndex).toHaveBeenCalledWith({
				collection_name: 'test_collection',
				field_name: 'vector',
				index_name: 'vector_index',
				index_type: 'AUTOINDEX',
				metric_type: 'COSINE',
			});
			expect(mockMilvusClient.loadCollection).toHaveBeenCalled();
		});

		it('should handle describeIndex error by creating missing indexes', async () => {
			mockMilvusClient.showCollections.mockResolvedValue({ data: [{ name: 'test_collection' }] });
			mockMilvusClient.describeIndex.mockRejectedValue(new Error('Index not found'));
			mockMilvusClient.createIndex.mockResolvedValue({});
			mockMilvusClient.loadCollection.mockResolvedValue({});

			await backend.connect();

			expect(mockMilvusClient.showCollections).toHaveBeenCalled();
			expect(mockMilvusClient.describeIndex).toHaveBeenCalled();
			expect(mockMilvusClient.createIndex).toHaveBeenCalledWith({
				collection_name: 'test_collection',
				field_name: 'vector',
				index_name: 'vector_index',
				index_type: 'AUTOINDEX',
				metric_type: 'COSINE',
			});
			expect(mockMilvusClient.loadCollection).toHaveBeenCalled();
		});

		it('should create collection if it does not exist', async () => {
			mockMilvusClient.showCollections.mockResolvedValue({ data: [] });
			mockMilvusClient.createCollection.mockResolvedValue({});
			mockMilvusClient.loadCollection.mockResolvedValue({});

			await backend.connect();

			expect(mockMilvusClient.showCollections).toHaveBeenCalled();
			expect(mockMilvusClient.createCollection).toHaveBeenCalledWith({
				collection_name: 'test_collection',
				fields: expect.any(Array),
				// Expect index parameters to be included during collection creation
				index_params: [
					{
						field_name: 'vector',
						index_name: 'vector_index',
						index_type: 'AUTOINDEX',
						metric_type: 'COSINE',
					},
				],
			});
			// createIndex should NOT be called separately anymore
			expect(mockMilvusClient.createIndex).not.toHaveBeenCalled();
			expect(mockMilvusClient.loadCollection).toHaveBeenCalled();
		});

		it('should handle connection failures', async () => {
			mockMilvusClient.showCollections.mockRejectedValue(new Error('Connection failed'));
			await expect(backend.connect()).rejects.toThrow(VectorStoreConnectionError);
			expect(backend.isConnected()).toBe(false);
		});

		it('should disconnect successfully', async () => {
			mockMilvusClient.showCollections.mockResolvedValue({ data: [{ name: 'test_collection' }] });
			mockMilvusClient.loadCollection.mockResolvedValue({});
			await backend.connect();
			await backend.disconnect();
			expect(backend.isConnected()).toBe(false);
		});

		it('should return correct backend type', () => {
			expect(backend.getBackendType()).toBe('milvus');
		});

		it('should return correct metadata', () => {
			expect(backend.getDimension()).toBe(3);
			expect(backend.getCollectionName()).toBe('test_collection');
		});

		it('should not throw when disconnect is called while not connected', async () => {
			await expect(backend.disconnect()).resolves.not.toThrow();
		});
	});

	describe('Vector Operations', () => {
		beforeEach(async () => {
			mockMilvusClient.showCollections.mockResolvedValue({ data: [{ name: 'test_collection' }] });
			mockMilvusClient.loadCollection.mockResolvedValue({});
			await backend.connect();
		});

		it('should insert vectors successfully', async () => {
			mockMilvusClient.insert.mockResolvedValue({});
			const vectors = [
				[1, 2, 3],
				[4, 5, 6],
			];
			const ids = [1, 2];
			const payloads = [{ title: 'First' }, { title: 'Second' }];
			await backend.insert(vectors, ids, payloads);
			expect(mockMilvusClient.insert).toHaveBeenCalledWith({
				collection_name: 'test_collection',
				data: [
					{ id: 1, vector: [1, 2, 3], payload: { title: 'First' } },
					{ id: 2, vector: [4, 5, 6], payload: { title: 'Second' } },
				],
			});
		});

		it('should retrieve vectors by ID', async () => {
			mockMilvusClient.query.mockResolvedValue({
				data: [{ id: '1', vector: [1, 2, 3], payload: { title: 'Test' } }],
			});
			const result = await backend.get(1);
			expect(result).toEqual({
				id: 1,
				vector: [1, 2, 3],
				payload: { title: 'Test' },
				score: 1.0,
			});
		});

		it('should return null if vector not found', async () => {
			mockMilvusClient.query.mockResolvedValue({ data: [] });
			const result = await backend.get(999);
			expect(result).toBeNull();
		});

		it('should update vectors successfully', async () => {
			mockMilvusClient.upsert.mockResolvedValue({});
			await backend.update(1, [1, 2, 3], { title: 'Updated' });
			expect(mockMilvusClient.upsert).toHaveBeenCalledWith({
				collection_name: 'test_collection',
				data: [{ id: 1, vector: [1, 2, 3], payload: { title: 'Updated' } }],
			});
		});

		it('should delete vectors successfully', async () => {
			mockMilvusClient.deleteEntities.mockResolvedValue({});
			await backend.delete(1);
			expect(mockMilvusClient.deleteEntities).toHaveBeenCalledWith({
				collection_name: 'test_collection',
				expr: 'id == 1',
			});
		});

		it('should search vectors successfully', async () => {
			mockMilvusClient.search.mockResolvedValue({
				results: [{ id: '1', score: 0.99, payload: { title: 'Test' } }],
			});
			const result = await backend.search([1, 2, 3], 1);
			expect(result).toEqual([{ id: '1', score: 0.99, payload: { title: 'Test' } }]);
		});

		it('should list vectors successfully', async () => {
			mockMilvusClient.query.mockResolvedValue({
				data: [{ id: '1', vector: [1, 2, 3], payload: { title: 'Test' } }],
			});
			const [results, count] = await backend.list();
			expect(results).toEqual([
				{ id: '1', vector: [1, 2, 3], payload: { title: 'Test' }, score: 1.0 },
			]);
			expect(count).toBe(1);
		});

		it('should throw VectorStoreError if insert is called before connect', async () => {
			const backend = new MilvusBackend(validConfig);
			const vectors = [[1, 2, 3]];
			const ids = [1];
			const payloads = [{ title: 'Test' }];
			await expect(backend.insert(vectors, ids, payloads)).rejects.toThrow(VectorStoreError);
		});

		it('should throw VectorStoreError if update is called before connect', async () => {
			const backend = new MilvusBackend(validConfig);
			await expect(backend.update(1, [1, 2, 3], { title: 'Test' })).rejects.toThrow(
				VectorStoreError
			);
		});

		it('should throw VectorStoreError if delete is called before connect', async () => {
			const backend = new MilvusBackend(validConfig);
			await expect(backend.delete(1)).rejects.toThrow(VectorStoreError);
		});

		it('should throw VectorStoreError if get is called before connect', async () => {
			const backend = new MilvusBackend(validConfig);
			await expect(backend.get(1)).rejects.toThrow(VectorStoreError);
		});

		it('should throw VectorStoreError if vectors, ids, and payloads lengths do not match', async () => {
			mockMilvusClient.showCollections.mockResolvedValue({ data: [{ name: 'test_collection' }] });
			mockMilvusClient.loadCollection.mockResolvedValue({});
			await backend.connect();
			await expect(backend.insert([[1, 2, 3]], [1, 2], [{ title: 'Test' }])).rejects.toThrow(
				VectorStoreError
			);
		});

		it('should throw VectorDimensionError if update vector has wrong dimension', async () => {
			mockMilvusClient.showCollections.mockResolvedValue({ data: [{ name: 'test_collection' }] });
			mockMilvusClient.loadCollection.mockResolvedValue({});
			await backend.connect();
			await expect(backend.update(1, [1, 2], { title: 'Test' })).rejects.toThrow(
				VectorDimensionError
			);
		});

		it('should throw if payloads are null or undefined', async () => {
			await backend.connect();
			await expect(backend.insert([[1, 2, 3]], [1], null as any)).rejects.toThrow();
			await expect(backend.insert([[1, 2, 3]], [1], undefined as any)).rejects.toThrow();
		});

		it('should throw VectorDimensionError if search vector has wrong dimension', async () => {
			await backend.connect();
			await expect(backend.search([1, 2], 1)).rejects.toThrow(VectorDimensionError);
		});

		it('should throw VectorStoreError on get failure', async () => {
			mockMilvusClient.query.mockRejectedValue(new Error('Query failed'));
			await backend.connect();
			await expect(backend.get(1)).rejects.toThrow(VectorStoreError);
		});

		it('should throw VectorStoreError on list failure', async () => {
			mockMilvusClient.query.mockRejectedValue(new Error('Query failed'));
			await backend.connect();
			await expect(backend.list()).rejects.toThrow(VectorStoreError);
		});

		it('should throw VectorStoreError on upsert failure', async () => {
			mockMilvusClient.upsert.mockRejectedValue(new Error('Upsert failed'));
			await backend.connect();
			await expect(backend.update(1, [1, 2, 3], { title: 'Fail' })).rejects.toThrow(
				VectorStoreError
			);
		});

		it('should throw VectorStoreError on deleteEntities failure', async () => {
			mockMilvusClient.deleteEntities.mockRejectedValue(new Error('Delete failed'));
			await backend.connect();
			await expect(backend.delete(1)).rejects.toThrow(VectorStoreError);
		});
	});

	describe('Collection Management', () => {
		beforeEach(async () => {
			mockMilvusClient.showCollections.mockResolvedValue({ data: [{ name: 'test_collection' }] });
			mockMilvusClient.loadCollection.mockResolvedValue({});
			await backend.connect();
		});

		it('should delete collection successfully', async () => {
			mockMilvusClient.dropCollection.mockResolvedValue({});
			await backend.deleteCollection();
			expect(mockMilvusClient.dropCollection).toHaveBeenCalledWith({
				collection_name: 'test_collection',
			});
		});

		it('should list all collections', async () => {
			mockMilvusClient.showCollections.mockResolvedValue({
				data: [{ name: 'col1' }, { name: 'col2' }],
			});
			const backend = new MilvusBackend(validConfig);
			mockMilvusClient.loadCollection.mockResolvedValue({});
			await backend.connect();
			const collections = await backend.listCollections();
			expect(collections).toEqual(['col1', 'col2']);
		});

		it('should throw VectorStoreError if deleteCollection is called before connect', async () => {
			const backend = new MilvusBackend(validConfig);
			await expect(backend.deleteCollection()).rejects.toThrow(VectorStoreError);
		});

		it('should throw VectorStoreError if listCollections is called before connect', async () => {
			const backend = new MilvusBackend(validConfig);
			await expect(backend.listCollections()).rejects.toThrow(VectorStoreError);
		});

		it('should throw VectorStoreError on dropCollection failure', async () => {
			mockMilvusClient.dropCollection.mockRejectedValue(new Error('Drop failed'));
			await backend.connect();
			await expect(backend.deleteCollection()).rejects.toThrow(VectorStoreError);
		});
	});

	describe('Error Handling', () => {
		beforeEach(async () => {
			mockMilvusClient.showCollections.mockResolvedValue({ data: [{ name: 'test_collection' }] });
			mockMilvusClient.loadCollection.mockResolvedValue({});
			await backend.connect();
		});

		it('should throw VectorDimensionError on dimension mismatch', async () => {
			await expect(backend.insert([[1, 2]], [1], [{ title: 'Bad' }])).rejects.toThrow(
				VectorDimensionError
			);
		});

		it('should throw VectorStoreError on insert failure', async () => {
			mockMilvusClient.insert.mockRejectedValue(new Error('Insert failed'));
			await expect(backend.insert([[1, 2, 3]], [1], [{ title: 'Fail' }])).rejects.toThrow(
				VectorStoreError
			);
		});

		it('should throw VectorStoreError on search failure', async () => {
			mockMilvusClient.search.mockRejectedValue(new Error('Search failed'));
			await expect(backend.search([1, 2, 3], 1)).rejects.toThrow(VectorStoreError);
		});
	});
});
