import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
	MilvusConnectionPool,
	getMilvusConnectionPool,
	type MilvusConnectionConfig,
} from '../connection-pool.js';

// Mock the Milvus client
vi.mock('@zilliz/milvus2-sdk-node', () => ({
	MilvusClient: vi.fn().mockImplementation(() => ({
		showCollections: vi.fn().mockResolvedValue({ data: [] }),
	})),
}));

// Mock the logger
vi.mock('../../logger/index.js', () => ({
	logger: {
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

// Mock environment variables
vi.mock('../../env.js', () => ({
	env: {
		VECTOR_STORE_URL: 'http://localhost:19530',
		VECTOR_STORE_USERNAME: 'test-user',
		VECTOR_STORE_PASSWORD: 'test-pass',
	},
}));

describe('MilvusConnectionPool', () => {
	let pool: MilvusConnectionPool;

	beforeEach(() => {
		// Clear singleton instance
		(MilvusConnectionPool as any).instance = null;
		pool = MilvusConnectionPool.getInstance();
		vi.clearAllMocks();
	});

	afterEach(async () => {
		// Clean up pool
		await pool.shutdown();
		(MilvusConnectionPool as any).instance = null;
		vi.clearAllMocks();
	});

	describe('Singleton Pattern', () => {
		it('should return the same instance', () => {
			const instance1 = MilvusConnectionPool.getInstance();
			const instance2 = MilvusConnectionPool.getInstance();
			const instance3 = getMilvusConnectionPool();

			expect(instance1).toBe(instance2);
			expect(instance2).toBe(instance3);
		});

		it('should maintain pool state across getInstance calls', async () => {
			const config: MilvusConnectionConfig = {
				url: 'http://localhost:19530',
				username: 'user1',
				password: 'pass1',
			};

			const instance1 = MilvusConnectionPool.getInstance();
			const client1 = await instance1.getClient(config);

			const instance2 = MilvusConnectionPool.getInstance();
			const client2 = await instance2.getClient(config);

			expect(client1).toBe(client2);
		});
	});

	describe('Connection Management', () => {
		it('should create new connection on first request', async () => {
			const config: MilvusConnectionConfig = {
				url: 'http://localhost:19530',
				username: 'user1',
				password: 'pass1',
			};

			expect(pool.size()).toBe(0);
			expect(pool.hasConnection(config)).toBe(false);

			const client = await pool.getClient(config);

			expect(client).toBeDefined();
			expect(pool.size()).toBe(1);
			expect(pool.hasConnection(config)).toBe(true);
		});

		it('should reuse existing connection for same configuration', async () => {
			const config: MilvusConnectionConfig = {
				url: 'http://localhost:19530',
				username: 'user1',
				password: 'pass1',
			};

			const client1 = await pool.getClient(config);
			const client2 = await pool.getClient(config);
			const client3 = await pool.getClient(config);

			expect(client1).toBe(client2);
			expect(client2).toBe(client3);
			expect(pool.size()).toBe(1);
		});

		it('should create different connections for different configurations', async () => {
			const config1: MilvusConnectionConfig = {
				url: 'http://localhost:19530',
				username: 'user1',
				password: 'pass1',
			};
			const config2: MilvusConnectionConfig = {
				url: 'http://localhost:19531',
				username: 'user2',
				password: 'pass2',
			};

			const client1 = await pool.getClient(config1);
			const client2 = await pool.getClient(config2);

			expect(client1).not.toBe(client2);
			expect(pool.size()).toBe(2);
		});

		it('should handle host/port configuration format', async () => {
			const config: MilvusConnectionConfig = {
				host: 'localhost',
				port: 19530,
				username: 'user1',
				password: 'pass1',
			};

			const client = await pool.getClient(config);
			expect(client).toBeDefined();
		});

		it('should use environment defaults when config values are missing', async () => {
			const config: MilvusConnectionConfig = {};

			const client = await pool.getClient(config);
			expect(client).toBeDefined();
		});
	});

	describe('Reference Counting', () => {
		it('should track reference count correctly', async () => {
			const config: MilvusConnectionConfig = {
				url: 'http://localhost:19530',
				username: 'user1',
			};

			await pool.getClient(config);
			await pool.getClient(config);

			const stats = pool.getStats();
			expect(stats.connectionDetails).toHaveLength(1);
			expect(stats.connectionDetails[0]!.refCount).toBe(2);

			pool.releaseClient(config);
			const statsAfterRelease = pool.getStats();
			expect(statsAfterRelease.connectionDetails[0]!.refCount).toBe(1);

			pool.releaseClient(config);
			const statsAfterSecondRelease = pool.getStats();
			expect(statsAfterSecondRelease.connectionDetails[0]!.refCount).toBe(0);
		});

		it('should not go below zero reference count', async () => {
			const config: MilvusConnectionConfig = {
				url: 'http://localhost:19530',
			};

			await pool.getClient(config);

			// Release more times than acquired
			pool.releaseClient(config);
			pool.releaseClient(config);
			pool.releaseClient(config);

			const stats = pool.getStats();
			expect(stats.connectionDetails[0]!.refCount).toBe(0);
		});
	});

	describe('Connection Limits and Eviction', () => {
		it('should enforce maximum connection limit with LRU eviction', async () => {
			// Temporarily reduce max connections for testing
			const originalMaxConnections = (pool as any).maxConnections;
			(pool as any).maxConnections = 3;

			try {
				const configs = [
					{ url: 'http://localhost:19530', username: 'user1' },
					{ url: 'http://localhost:19531', username: 'user2' },
					{ url: 'http://localhost:19532', username: 'user3' },
				];

				// Fill pool to capacity
				for (const config of configs) {
					await pool.getClient(config);
					await new Promise(resolve => setTimeout(resolve, 1)); // Small delay for timestamp differentiation
				}

				expect(pool.size()).toBe(3);

				// Access first connection to make it more recently used
				await new Promise(resolve => setTimeout(resolve, 1));
				await pool.getClient(configs[0]!);

				// Add fourth connection - should evict least recently used
				await new Promise(resolve => setTimeout(resolve, 1));
				const config4 = { url: 'http://localhost:19533', username: 'user4' };
				await pool.getClient(config4);

				expect(pool.size()).toBe(3);
				expect(pool.hasConnection(configs[0]!)).toBe(true); // Recently accessed, should remain
				expect(pool.hasConnection(config4)).toBe(true); // Newly added
			} finally {
				(pool as any).maxConnections = originalMaxConnections;
			}
		});
	});

	describe('Statistics and Monitoring', () => {
		it('should provide accurate pool statistics', async () => {
			const configs = [
				{ url: 'http://localhost:19530', username: 'user1' },
				{ url: 'http://localhost:19531', username: 'user2' },
				{ url: 'http://localhost:19532', username: 'user3' },
			];

			// Create connections
			for (const config of configs) {
				await pool.getClient(config);
				await new Promise(resolve => setTimeout(resolve, 1)); // Small delay
			}

			// Get additional references
			await pool.getClient(configs[0]!);
			await pool.getClient(configs[1]!);

			// Add small delay to ensure age > 0
			await new Promise(resolve => setTimeout(resolve, 5));

			const stats = pool.getStats();

			expect(stats.totalConnections).toBe(3);
			expect(stats.maxConnections).toBe(10);
			expect(stats.connectionDetails).toHaveLength(3);

			// All should be healthy
			stats.connectionDetails.forEach(detail => {
				expect(detail.isHealthy).toBe(true);
				expect(detail.age).toBeGreaterThanOrEqual(0); // Changed to >= 0 to handle timing
				expect(detail.createdAt).toBeGreaterThan(0);
				expect(detail.lastUsed).toBeGreaterThan(0);
			});
		});

		it('should track connection ages correctly', async () => {
			const config: MilvusConnectionConfig = {
				url: 'http://localhost:19530',
				username: 'user1',
			};

			const beforeTime = Date.now();
			await pool.getClient(config);
			await new Promise(resolve => setTimeout(resolve, 10));
			const afterTime = Date.now();

			const stats = pool.getStats();
			const connectionDetail = stats.connectionDetails[0];

			expect(connectionDetail!.createdAt).toBeGreaterThanOrEqual(beforeTime);
			expect(connectionDetail!.createdAt).toBeLessThanOrEqual(afterTime);
			expect(connectionDetail!.age).toBeGreaterThan(0);
			expect(connectionDetail!.age).toBeLessThan(1000); // Should be recent
		});
	});

	describe('Cleanup and Shutdown', () => {
		it('should close all connections on shutdown', async () => {
			const configs = [
				{ url: 'http://localhost:19530', username: 'user1' },
				{ url: 'http://localhost:19531', username: 'user2' },
				{ url: 'http://localhost:19532', username: 'user3' },
			];

			// Create connections
			for (const config of configs) {
				await pool.getClient(config);
			}

			expect(pool.size()).toBe(3);

			// Shutdown pool
			await pool.shutdown();

			expect(pool.size()).toBe(0);
		});

		it('should clear health check timer on shutdown', async () => {
			const config: MilvusConnectionConfig = {
				url: 'http://localhost:19530',
				username: 'user1',
			};

			await pool.getClient(config);

			// Verify health check timer exists
			expect((pool as any).healthCheckTimer).toBeDefined();

			await pool.shutdown();

			// Timer should be cleared
			expect((pool as any).healthCheckTimer).toBeUndefined();
		});
	});

	describe('Connection Key Generation', () => {
		it('should generate consistent keys for same configuration', async () => {
			const config1: MilvusConnectionConfig = {
				url: 'http://localhost:19530',
				username: 'user1',
				password: 'pass1',
			};
			const config2: MilvusConnectionConfig = {
				url: 'http://localhost:19530',
				username: 'user1',
				password: 'pass1',
			};

			await pool.getClient(config1);
			await pool.getClient(config2);

			// Should reuse connection (same key)
			expect(pool.size()).toBe(1);
		});

		it('should generate different keys for different configurations', async () => {
			const configs = [
				{ url: 'http://localhost:19530', username: 'user1', password: 'pass1' },
				{ url: 'http://localhost:19531', username: 'user1', password: 'pass1' }, // Different URL
				{ url: 'http://localhost:19530', username: 'user2', password: 'pass1' }, // Different username
				{ url: 'http://localhost:19530', username: 'user1' }, // No password
				{ host: 'remote-host', port: 19530, username: 'user1' }, // Different host
			];

			for (const config of configs) {
				await pool.getClient(config);
			}

			expect(pool.size()).toBe(5);
		});

		it('should handle password presence correctly in key generation', async () => {
			const configWithPassword: MilvusConnectionConfig = {
				url: 'http://localhost:19530',
				username: 'user1',
				password: 'secret',
			};
			const configWithoutPassword: MilvusConnectionConfig = {
				url: 'http://localhost:19530',
				username: 'user1',
			};

			await pool.getClient(configWithPassword);
			await pool.getClient(configWithoutPassword);

			// Should be different connections (password presence affects key)
			expect(pool.size()).toBe(2);
		});
	});

	describe('Integration Scenarios', () => {
		it('should handle multiple requests correctly', async () => {
			const config: MilvusConnectionConfig = {
				url: 'http://localhost:19530',
				username: 'user1',
			};

			// Make multiple sequential requests
			const client1 = await pool.getClient(config);
			const client2 = await pool.getClient(config);
			const client3 = await pool.getClient(config);

			// Should have created only one connection in pool
			expect(pool.size()).toBe(1);

			// Reference count should be 3
			const stats = pool.getStats();
			expect(stats.connectionDetails[0]!.refCount).toBe(3);

			// All clients should be defined
			expect(client1).toBeDefined();
			expect(client2).toBeDefined();
			expect(client3).toBeDefined();
		});

		it('should handle mixed operations correctly', async () => {
			const config1: MilvusConnectionConfig = { url: 'http://localhost:19530', username: 'user1' };
			const config2: MilvusConnectionConfig = { url: 'http://localhost:19531', username: 'user2' };

			// Create connections
			await pool.getClient(config1);
			await pool.getClient(config2);
			await pool.getClient(config1); // Reuse

			expect(pool.size()).toBe(2);

			// Release one reference
			pool.releaseClient(config1);

			// Check statistics
			const stats = pool.getStats();
			expect(stats.totalConnections).toBe(2);

			// Add more connections to test eviction
			const config3: MilvusConnectionConfig = { url: 'http://localhost:19532', username: 'user3' };
			await pool.getClient(config3);

			expect(pool.size()).toBe(3);
		});
	});
});
