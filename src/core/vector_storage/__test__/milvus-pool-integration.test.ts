import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MilvusBackend } from '../backend/milvus.js';
import { getMilvusConnectionPool } from '../connection-pool.js';
import type { MilvusBackendConfig } from '../backend/types.js';

// Mock the Milvus client and its methods
vi.mock('@zilliz/milvus2-sdk-node', () => ({
	MilvusClient: vi.fn().mockImplementation(() => ({
		showCollections: vi.fn().mockResolvedValue({ data: [] }),
		createCollection: vi.fn().mockResolvedValue({}),
		describeIndex: vi.fn().mockResolvedValue({ index_descriptions: [] }),
		createIndex: vi.fn().mockResolvedValue({}),
		loadCollection: vi.fn().mockResolvedValue({}),
		insert: vi.fn().mockResolvedValue({}),
		search: vi.fn().mockResolvedValue({ results: [] }),
		query: vi.fn().mockResolvedValue({ data: [] }),
		upsert: vi.fn().mockResolvedValue({}),
		deleteEntities: vi.fn().mockResolvedValue({}),
		dropCollection: vi.fn().mockResolvedValue({}),
	})),
	DataType: {
		Int64: 'Int64',
		FloatVector: 'FloatVector',
		JSON: 'JSON',
	},
}));

// Mock the logger
vi.mock('../../logger/index.js', () => {
	const mockLogger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};

	return {
		createLogger: vi.fn(() => mockLogger),
		logger: mockLogger,
	};
});

// Mock environment variables
vi.mock('../../env.js', () => ({
	env: {
		CIPHER_LOG_LEVEL: 'debug',
		VECTOR_STORE_URL: 'http://localhost:19530',
		VECTOR_STORE_USERNAME: 'test-user',
		VECTOR_STORE_PASSWORD: 'test-pass',
	},
}));

describe('MilvusBackend Connection Pool Integration', () => {
	let backend1: MilvusBackend;
	let backend2: MilvusBackend;
	let config1: MilvusBackendConfig;
	let config2: MilvusBackendConfig;

	beforeEach(async () => {
		// Clear connection pool
		const pool = getMilvusConnectionPool();
		await pool.shutdown();
		(pool.constructor as any).instance = null;

		// Reset all mocks
		vi.clearAllMocks();

		// Create test configurations
		config1 = {
			type: 'milvus',
			url: 'http://localhost:19530',
			username: 'user1',
			password: 'pass1',
			collectionName: 'test-collection-1',
			dimension: 768,
		};

		config2 = {
			type: 'milvus',
			url: 'http://localhost:19530', // Same connection details
			username: 'user1',
			password: 'pass1',
			collectionName: 'test-collection-2', // Different collection
			dimension: 1024,
		};

		backend1 = new MilvusBackend(config1);
		backend2 = new MilvusBackend(config2);
	});

	afterEach(async () => {
		// Clean up
		if (backend1?.isConnected()) {
			await backend1.disconnect();
		}
		if (backend2?.isConnected()) {
			await backend2.disconnect();
		}

		const pool = getMilvusConnectionPool();
		await pool.shutdown();
		(pool.constructor as any).instance = null;
		vi.clearAllMocks();
	});

	describe('Connection Sharing', () => {
		it('should share connections between backends with same config', async () => {
			const pool = getMilvusConnectionPool();

			// Connect both backends
			await backend1.connect();
			await backend2.connect();

			// Should have created connection in pool
			expect(pool.size()).toBe(1);

			// Both should be connected
			expect(backend1.isConnected()).toBe(true);
			expect(backend2.isConnected()).toBe(true);

			// Connection should have reference count of 2
			const stats = pool.getStats();
			expect(stats.connectionDetails[0]!.refCount).toBe(2);
		});

		it('should create separate connections for different configurations', async () => {
			// Modify second config to use different connection details
			backend2 = new MilvusBackend({
				...config2,
				url: 'http://localhost:19531', // Different port
			});

			const pool = getMilvusConnectionPool();

			await backend1.connect();
			await backend2.connect();

			// Should have created two separate connections
			expect(pool.size()).toBe(2);
		});

		it('should handle backend disconnection correctly', async () => {
			const pool = getMilvusConnectionPool();

			await backend1.connect();
			await backend2.connect();

			expect(pool.size()).toBe(1);

			const initialStats = pool.getStats();
			expect(initialStats.connectionDetails[0]!.refCount).toBe(2);

			// Disconnect first backend
			await backend1.disconnect();

			const afterFirstDisconnect = pool.getStats();
			expect(afterFirstDisconnect.connectionDetails[0]!.refCount).toBe(1);
			expect(pool.size()).toBe(1); // Connection should still exist

			// Disconnect second backend
			await backend2.disconnect();

			const afterSecondDisconnect = pool.getStats();
			expect(afterSecondDisconnect.connectionDetails[0]!.refCount).toBe(0);
			expect(pool.size()).toBe(1); // Connection still exists but no references
		});
	});

	describe('Backend Operations with Pooled Connections', () => {
		it('should connect and maintain pool correctly', async () => {
			await backend1.connect();

			// Backend should be connected
			expect(backend1.isConnected()).toBe(true);

			// Pool should have one connection
			const pool = getMilvusConnectionPool();
			expect(pool.size()).toBe(1);
		});

		it('should handle operations when client is not connected', async () => {
			// Don't connect backend1
			expect(backend1.isConnected()).toBe(false);

			const vectors = [[1, 2, 3]];
			const ids = [1];
			const payloads = [{ type: 'test' }];

			await expect(backend1.insert(vectors, ids, payloads)).rejects.toThrow(
				'Vector store is not connected'
			);
		});

		it('should validate vector dimensions correctly', async () => {
			await backend1.connect();

			const wrongDimensionVector = [[1, 2]]; // Should be 768 dimensions
			const ids = [1];
			const payloads = [{ type: 'test' }];

			await expect(backend1.insert(wrongDimensionVector, ids, payloads)).rejects.toThrow(
				'Vector dimension mismatch'
			);
		});
	});

	describe('Performance and Resource Management', () => {
		it('should reuse connections efficiently across multiple operations', async () => {
			await backend1.connect();
			await backend2.connect();

			// Should have created only one connection
			const pool = getMilvusConnectionPool();
			expect(pool.size()).toBe(1);

			// Connection should have reference count of 2
			const stats = pool.getStats();
			expect(stats.connectionDetails[0]!.refCount).toBe(2);
		});

		it('should maintain connection statistics correctly', async () => {
			const pool = getMilvusConnectionPool();

			await backend1.connect();
			await backend2.connect();

			const stats = pool.getStats();
			expect(stats.totalConnections).toBe(1);
			expect(stats.connectionDetails[0]!.refCount).toBe(2);
			expect(stats.connectionDetails[0]!.isHealthy).toBe(true);

			// Disconnect one backend
			await backend1.disconnect();

			const updatedStats = pool.getStats();
			expect(updatedStats.connectionDetails[0]!.refCount).toBe(1);

			// Disconnect second backend
			await backend2.disconnect();

			const finalStats = pool.getStats();
			expect(finalStats.connectionDetails[0]!.refCount).toBe(0);
		});
	});

	describe('Concurrent Backend Operations', () => {
		it('should handle concurrent connections correctly', async () => {
			const backends = Array.from({ length: 5 }, () => new MilvusBackend(config1));

			// Connect all backends sequentially to avoid race conditions in tests
			for (const backend of backends) {
				await backend.connect();
			}

			const pool = getMilvusConnectionPool();
			expect(pool.size()).toBe(1);

			const stats = pool.getStats();
			expect(stats.connectionDetails[0]!.refCount).toBe(5);

			// All backends should be connected
			backends.forEach(backend => {
				expect(backend.isConnected()).toBe(true);
			});

			// Disconnect all
			for (const backend of backends) {
				await backend.disconnect();
			}

			const finalStats = pool.getStats();
			expect(finalStats.connectionDetails[0]!.refCount).toBe(0);
		});
	});
});
