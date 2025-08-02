import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { logger } from '../logger/index.js';
import { env } from '../env.js';

/**
 * Connection configuration for Milvus client pool
 */
export interface MilvusConnectionConfig {
	url?: string;
	host?: string;
	port?: number;
	username?: string;
	password?: string;
}

/**
 * Pooled connection information
 */
interface PooledConnection {
	client: MilvusClient;
	createdAt: number;
	lastUsed: number;
	isHealthy: boolean;
	refCount: number; // Reference count for active usage
}

/**
 * Thread-safe singleton connection pool for Milvus clients
 * Reduces duplicate TCP connections by sharing client instances across collections
 */
export class MilvusConnectionPool {
	private static instance: MilvusConnectionPool | null = null;
	private connections: Map<string, PooledConnection> = new Map();
	private readonly maxConnections = 10; // Prevent connection bloat
	private readonly connectionTtl = 300000; // 5 minutes TTL
	private readonly healthCheckInterval = 60000; // 1 minute health checks
	private healthCheckTimer?: NodeJS.Timeout;

	private constructor() {
		// Private constructor for singleton pattern
		this.startHealthCheckTimer();
	}

	/**
	 * Get the singleton instance of MilvusConnectionPool
	 */
	static getInstance(): MilvusConnectionPool {
		if (!MilvusConnectionPool.instance) {
			MilvusConnectionPool.instance = new MilvusConnectionPool();
		}
		return MilvusConnectionPool.instance;
	}

	/**
	 * Generate a unique connection key based on configuration
	 */
	private generateConnectionKey(config: MilvusConnectionConfig): string {
		// Normalize the configuration for consistent keying
		const address =
			config.url ||
			(config.host && config.port ? `http://${config.host}:${config.port}` : env.VECTOR_STORE_URL);
		const username = config.username || env.VECTOR_STORE_USERNAME || '';
		const password = config.password ? '[REDACTED]' : ''; // Don't include actual password in key

		return `${address}:${username}:${!!password}`;
	}

	/**
	 * Get or create a Milvus client from the pool
	 */
	async getClient(config: MilvusConnectionConfig): Promise<MilvusClient> {
		const connectionKey = this.generateConnectionKey(config);

		// Check if connection exists and is healthy
		const existingConnection = this.connections.get(connectionKey);
		if (existingConnection && existingConnection.isHealthy) {
			// Update usage tracking
			existingConnection.lastUsed = Date.now();
			existingConnection.refCount++;

			logger.debug('MilvusConnectionPool: Reusing existing connection', {
				connectionKey,
				refCount: existingConnection.refCount,
				poolSize: this.connections.size,
			});

			return existingConnection.client;
		}

		// Remove unhealthy connection if it exists
		if (existingConnection && !existingConnection.isHealthy) {
			logger.debug('MilvusConnectionPool: Removing unhealthy connection', { connectionKey });
			this.connections.delete(connectionKey);
		}

		// Enforce max connections limit with LRU eviction
		if (this.connections.size >= this.maxConnections) {
			await this.evictLeastRecentlyUsedConnection();
		}

		// Create new connection
		logger.debug('MilvusConnectionPool: Creating new connection', {
			connectionKey,
			poolSize: this.connections.size,
		});

		const client = await this.createMilvusClient(config);
		const pooledConnection: PooledConnection = {
			client,
			createdAt: Date.now(),
			lastUsed: Date.now(),
			isHealthy: true,
			refCount: 1,
		};

		this.connections.set(connectionKey, pooledConnection);

		logger.debug('MilvusConnectionPool: Connection created and pooled', {
			connectionKey,
			poolSize: this.connections.size,
		});

		return client;
	}

	/**
	 * Release a client reference (decrement ref count)
	 */
	releaseClient(config: MilvusConnectionConfig): void {
		const connectionKey = this.generateConnectionKey(config);
		const connection = this.connections.get(connectionKey);

		if (connection) {
			connection.refCount = Math.max(0, connection.refCount - 1);
			logger.debug('MilvusConnectionPool: Client reference released', {
				connectionKey,
				refCount: connection.refCount,
			});
		}
	}

	/**
	 * Create a new Milvus client with the given configuration
	 */
	private async createMilvusClient(config: MilvusConnectionConfig): Promise<MilvusClient> {
		// Normalize configuration similar to existing backend
		const address =
			config.url ||
			(config.host && config.port
				? `http://${config.host}:${config.port}`
				: env.VECTOR_STORE_URL || '');
		const username = config.username || env.VECTOR_STORE_USERNAME || '';
		const password = config.password || env.VECTOR_STORE_PASSWORD || '';

		try {
			const client = new MilvusClient({
				address,
				username,
				password,
			});

			// Test the connection by trying to list collections
			await client.showCollections();

			return client;
		} catch (error) {
			logger.error('MilvusConnectionPool: Failed to create client', {
				error: error instanceof Error ? error.message : String(error),
				address,
			});
			throw error;
		}
	}

	/**
	 * Evict the least recently used connection to make room for new ones
	 */
	private async evictLeastRecentlyUsedConnection(): Promise<void> {
		let oldestKey: string | null = null;
		let oldestTime = Date.now();

		// Find connection with lowest ref count first, then oldest last used
		for (const [key, connection] of this.connections) {
			if (connection.refCount === 0 && connection.lastUsed < oldestTime) {
				oldestTime = connection.lastUsed;
				oldestKey = key;
			}
		}

		// If no unused connections, find least recently used with references
		if (!oldestKey) {
			for (const [key, connection] of this.connections) {
				if (connection.lastUsed < oldestTime) {
					oldestTime = connection.lastUsed;
					oldestKey = key;
				}
			}
		}

		if (oldestKey) {
			logger.debug('MilvusConnectionPool: Evicting LRU connection', {
				evictedKey: oldestKey,
				poolSize: this.connections.size,
			});

			await this.closeConnection(oldestKey);
		}
	}

	/**
	 * Start periodic health check timer
	 */
	private startHealthCheckTimer(): void {
		this.healthCheckTimer = setInterval(() => {
			this.performHealthChecks();
		}, this.healthCheckInterval);
	}

	/**
	 * Perform health checks on all pooled connections
	 */
	private async performHealthChecks(): Promise<void> {
		const now = Date.now();
		const connectionsToRemove: string[] = [];

		for (const [key, connection] of this.connections) {
			// Check if connection has expired
			if (now - connection.createdAt > this.connectionTtl) {
				logger.debug('MilvusConnectionPool: Connection expired', { key });
				connectionsToRemove.push(key);
				continue;
			}

			// Check if connection is healthy
			try {
				await connection.client.showCollections();
				connection.isHealthy = true;
			} catch (error) {
				logger.warn('MilvusConnectionPool: Connection health check failed', {
					key,
					error: error instanceof Error ? error.message : String(error),
				});
				connection.isHealthy = false;
				if (connection.refCount === 0) {
					connectionsToRemove.push(key);
				}
			}
		}

		// Remove unhealthy or expired connections
		for (const key of connectionsToRemove) {
			await this.closeConnection(key);
		}

		if (connectionsToRemove.length > 0) {
			logger.debug('MilvusConnectionPool: Health check completed', {
				removedConnections: connectionsToRemove.length,
				remainingConnections: this.connections.size,
			});
		}
	}

	/**
	 * Close and remove a connection from the pool
	 */
	private async closeConnection(key: string): Promise<void> {
		const connection = this.connections.get(key);
		if (connection) {
			try {
				// MilvusClient doesn't have an explicit close method
				// The connection will be cleaned up when the object is garbage collected
				this.connections.delete(key);
				logger.debug('MilvusConnectionPool: Connection closed and removed', { key });
			} catch (error) {
				logger.warn('MilvusConnectionPool: Error closing connection', {
					key,
					error: error instanceof Error ? error.message : String(error),
				});
				// Still remove it from the pool even if close failed
				this.connections.delete(key);
			}
		}
	}

	/**
	 * Get pool statistics for monitoring
	 */
	getStats(): {
		totalConnections: number;
		maxConnections: number;
		connectionDetails: Array<{
			key: string;
			createdAt: number;
			lastUsed: number;
			refCount: number;
			isHealthy: boolean;
			age: number;
		}>;
	} {
		const now = Date.now();
		const connectionDetails = Array.from(this.connections.entries()).map(([key, connection]) => ({
			key,
			createdAt: connection.createdAt,
			lastUsed: connection.lastUsed,
			refCount: connection.refCount,
			isHealthy: connection.isHealthy,
			age: now - connection.createdAt,
		}));

		return {
			totalConnections: this.connections.size,
			maxConnections: this.maxConnections,
			connectionDetails,
		};
	}

	/**
	 * Force close all connections and cleanup
	 */
	async shutdown(): Promise<void> {
		if (this.healthCheckTimer) {
			clearInterval(this.healthCheckTimer);
			this.healthCheckTimer = undefined as any;
		}

		const connectionKeys = Array.from(this.connections.keys());
		await Promise.allSettled(connectionKeys.map(key => this.closeConnection(key)));

		logger.debug('MilvusConnectionPool: Shutdown completed', {
			closedConnections: connectionKeys.length,
		});
	}

	/**
	 * Get current pool size
	 */
	size(): number {
		return this.connections.size;
	}

	/**
	 * Check if a connection exists for the given config
	 */
	hasConnection(config: MilvusConnectionConfig): boolean {
		const connectionKey = this.generateConnectionKey(config);
		const connection = this.connections.get(connectionKey);
		return connection !== undefined && connection.isHealthy;
	}
}

/**
 * Convenience function to get the global connection pool instance
 */
export const getMilvusConnectionPool = (): MilvusConnectionPool => {
	return MilvusConnectionPool.getInstance();
};
