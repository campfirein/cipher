/**
 * Storage Manager Implementation
 *
 * Orchestrates the dual-backend storage system with cache and database backends.
 * Provides lazy loading, graceful fallbacks, and connection management.
 *
 * @module storage/manager
 */

import type { CacheBackend, DatabaseBackend, StorageBackends, StorageConfig } from './types.js';
import { StorageSchema } from './config.js';
import { Logger, createLogger } from '../logger/index.js';
import {
	LOG_PREFIXES,
	ERROR_MESSAGES,
	TIMEOUTS,
	HEALTH_CHECK,
	BACKEND_TYPES,
} from './constants.js';

/**
 * Health check result for storage backends
 */
export interface HealthCheckResult {
	cache: boolean;
	database: boolean;
	overall: boolean;
	details?: {
		cache?: { status: string; latency?: number; error?: string };
		database?: { status: string; latency?: number; error?: string };
	};
}

/**
 * Storage system information
 */
export interface StorageInfo {
	connected: boolean;
	backends: {
		cache: {
			type: string;
			connected: boolean;
			fallback: boolean;
		};
		database: {
			type: string;
			connected: boolean;
			fallback: boolean;
		};
	};
	connectionAttempts: number;
	lastError: string | undefined;
}

/**
 * Storage Manager
 *
 * Manages the lifecycle of storage backends with lazy loading and fallback support.
 * Follows the factory pattern with graceful degradation to in-memory storage.
 *
 * @example
 * ```typescript
 * const manager = new StorageManager(config);
 * const { cache, database } = await manager.connect();
 *
 * // Use backends
 * await cache.set('key', value, 300);
 * await database.set('user:123', userData);
 *
 * // Cleanup
 * await manager.disconnect();
 * ```
 */
export class StorageManager {
	// Core state
	private cache: CacheBackend | undefined;
	private database: DatabaseBackend | undefined;
	private connected = false;
	private readonly config: StorageConfig;
	private readonly logger: Logger;

	// Connection tracking
	private connectionAttempts = 0;
	private lastConnectionError?: Error;

	// Backend metadata
	private cacheMetadata = {
		type: 'unknown',
		isFallback: false,
		connectionTime: 0,
	};

	private databaseMetadata = {
		type: 'unknown',
		isFallback: false,
		connectionTime: 0,
	};

	// Lazy loading module references (static to share across instances)
	private static redisModule?: any;
	private static sqliteModule?: any;
	private static postgresModule?: any;

	// Health check configuration
	private readonly healthCheckKey = HEALTH_CHECK.KEY;
	private readonly healthCheckTimeout = TIMEOUTS.HEALTH_CHECK;

	/**
	 * Creates a new StorageManager instance
	 *
	 * @param config - Storage configuration with cache and database backend configs
	 * @throws {Error} If configuration is invalid
	 */
	constructor(config: StorageConfig) {
		// Validate configuration using Zod schema
		const validationResult = StorageSchema.safeParse(config);
		if (!validationResult.success) {
			throw new Error(
				`${ERROR_MESSAGES.INVALID_CONFIG}: ${validationResult.error.errors
					.map(e => `${e.path.join('.')}: ${e.message}`)
					.join(', ')}`
			);
		}

		this.config = validationResult.data;
		this.logger = createLogger({
			level: process.env.LOG_LEVEL || 'info',
		});

		this.logger.info(`${LOG_PREFIXES.MANAGER} Initialized with configuration`, {
			cacheType: this.config.cache.type,
			databaseType: this.config.database.type,
		});
	}

	/**
	 * Get the current storage configuration
	 *
	 * @returns The storage configuration
	 */
	public getConfig(): Readonly<StorageConfig> {
		return this.config;
	}

	/**
	 * Get information about the storage system
	 *
	 * @returns Storage system information including connection status and backend types
	 */
	public getInfo(): StorageInfo {
		return {
			connected: this.connected,
			backends: {
				cache: {
					type: this.cacheMetadata.type,
					connected: this.cache?.isConnected() ?? false,
					fallback: this.cacheMetadata.isFallback,
				},
				database: {
					type: this.databaseMetadata.type,
					connected: this.database?.isConnected() ?? false,
					fallback: this.databaseMetadata.isFallback,
				},
			},
			connectionAttempts: this.connectionAttempts,
			lastError: this.lastConnectionError?.message,
		};
	}

	/**
	 * Get the current storage backends if connected
	 *
	 * @returns The storage backends or null if not connected
	 */
	public getBackends(): StorageBackends | null {
		if (!this.connected || !this.cache || !this.database) {
			return null;
		}

		return {
			cache: this.cache,
			database: this.database,
		};
	}

	/**
	 * Check if the storage manager is connected
	 *
	 * @returns true if both backends are connected
	 */
	public isConnected(): boolean {
		return (
			this.connected && this.cache?.isConnected() === true && this.database?.isConnected() === true
		);
	}

	// Placeholder methods for next phases

	/**
	 * Connect to storage backends
	 *
	 * @returns The connected storage backends
	 * @throws {StorageConnectionError} If strict backends fail to connect
	 */
	public async connect(): Promise<StorageBackends> {
		// Check if already connected
		if (this.connected) {
			this.logger.debug(`${LOG_PREFIXES.MANAGER} Already connected`, {
				cacheType: this.cacheMetadata.type,
				databaseType: this.databaseMetadata.type,
			});

			return {
				cache: this.cache!,
				database: this.database!,
			};
		}

		this.connectionAttempts++;
		this.logger.info(
			`${LOG_PREFIXES.MANAGER} Starting connection attempt ${this.connectionAttempts}`
		);

		try {
			// Create and connect cache backend
			const cacheStartTime = Date.now();
			try {
				this.cache = await this.createCacheBackend();
				await this.cache.connect();
				this.cacheMetadata.connectionTime = Date.now() - cacheStartTime;

				this.logger.info(`${LOG_PREFIXES.CACHE} Connected successfully`, {
					type: this.cacheMetadata.type,
					isFallback: this.cacheMetadata.isFallback,
					connectionTime: `${this.cacheMetadata.connectionTime}ms`,
				});
			} catch (cacheError) {
				// If the configured backend fails, try fallback to in-memory
				this.logger.warn(`${LOG_PREFIXES.CACHE} Connection failed, attempting fallback`, {
					error: cacheError instanceof Error ? cacheError.message : String(cacheError),
					originalType: this.config.cache.type,
				});

				if (this.config.cache.type !== BACKEND_TYPES.IN_MEMORY) {
					const { InMemoryBackend } = await import('./backend/in-memory.js');
					this.cache = new InMemoryBackend();
					await this.cache.connect();
					this.cacheMetadata.type = BACKEND_TYPES.IN_MEMORY;
					this.cacheMetadata.isFallback = true;
					this.cacheMetadata.connectionTime = Date.now() - cacheStartTime;

					this.logger.info(`${LOG_PREFIXES.CACHE} Connected to fallback backend`, {
						type: this.cacheMetadata.type,
						originalType: this.config.cache.type,
					});
				} else {
					throw cacheError; // Re-throw if already using in-memory
				}
			}

			// Create and connect database backend
			const dbStartTime = Date.now();
			try {
				this.database = await this.createDatabaseBackend();
				await this.database.connect();
				this.databaseMetadata.connectionTime = Date.now() - dbStartTime;

				this.logger.info(`${LOG_PREFIXES.DATABASE} Connected successfully`, {
					type: this.databaseMetadata.type,
					isFallback: this.databaseMetadata.isFallback,
					connectionTime: `${this.databaseMetadata.connectionTime}ms`,
				});
			} catch (err) {
				this.logger.error('Failed to connect to SQLite database', err);
				// If the configured backend fails, try fallback to in-memory
				this.logger.warn(`${LOG_PREFIXES.DATABASE} Connection failed, attempting fallback`, {
					error: err instanceof Error ? err.message : String(err),
					originalType: this.config.database.type,
				});

				if (this.config.database.type !== BACKEND_TYPES.IN_MEMORY) {
					const { InMemoryBackend } = await import('./backend/in-memory.js');
					this.database = new InMemoryBackend();
					await this.database.connect();
					this.databaseMetadata.type = BACKEND_TYPES.IN_MEMORY;
					this.databaseMetadata.isFallback = true;
					this.databaseMetadata.connectionTime = Date.now() - dbStartTime;

					this.logger.info(`${LOG_PREFIXES.DATABASE} Connected to fallback backend`, {
						type: this.databaseMetadata.type,
						originalType: this.config.database.type,
					});
				} else {
					throw err; // Re-throw if already using in-memory
				}
			}

			this.connected = true;

			this.logger.info(`${LOG_PREFIXES.MANAGER} Storage system connected`, {
				cacheBackend: this.cacheMetadata.type,
				databaseBackend: this.databaseMetadata.type,
				totalConnectionTime: `${this.cacheMetadata.connectionTime + this.databaseMetadata.connectionTime}ms`,
			});

			return {
				cache: this.cache!,
				database: this.database!,
			};
		} catch (error) {
			// Store error for reporting
			this.lastConnectionError = error as Error;

			// Disconnect any successfully connected backends
			if (this.cache?.isConnected()) {
				await this.cache.disconnect().catch(err =>
					this.logger.error(`${LOG_PREFIXES.CACHE} Error during cleanup disconnect`, {
						error: err,
					})
				);
			}

			if (this.database?.isConnected()) {
				await this.database.disconnect().catch(err =>
					this.logger.error(`${LOG_PREFIXES.DATABASE} Error during cleanup disconnect`, {
						error: err,
					})
				);
			}

			// Reset state
			this.cache = undefined;
			this.database = undefined;
			this.connected = false;

			throw error;
		}
	}

	/**
	 * Disconnect from all storage backends
	 */
	public async disconnect(): Promise<void> {
		if (!this.connected) {
			this.logger.debug(`${LOG_PREFIXES.MANAGER} Already disconnected`);
			return;
		}

		this.logger.info(`${LOG_PREFIXES.MANAGER} Disconnecting storage backends`);

		const disconnectPromises: Promise<void>[] = [];

		// Disconnect cache backend
		if (this.cache?.isConnected()) {
			disconnectPromises.push(
				this.cache
					.disconnect()
					.then(() => {
						this.logger.info(`${LOG_PREFIXES.CACHE} Disconnected successfully`);
					})
					.catch(error => {
						this.logger.error(`${LOG_PREFIXES.CACHE} Disconnect error`, { error });
						throw error;
					})
			);
		}

		// Disconnect database backend
		if (this.database?.isConnected()) {
			disconnectPromises.push(
				this.database
					.disconnect()
					.then(() => {
						this.logger.info(`${LOG_PREFIXES.DATABASE} Disconnected successfully`);
					})
					.catch(error => {
						this.logger.error(`${LOG_PREFIXES.DATABASE} Disconnect error`, { error });
						throw error;
					})
			);
		}

		// Wait for all disconnects with timeout
		try {
			await Promise.race([
				Promise.all(disconnectPromises),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error('Disconnect timeout')), TIMEOUTS.SHUTDOWN)
				),
			]);
		} finally {
			// Always clean up state
			this.cache = undefined;
			this.database = undefined;
			this.connected = false;

			// Reset metadata
			this.cacheMetadata = {
				type: 'unknown',
				isFallback: false,
				connectionTime: 0,
			};

			this.databaseMetadata = {
				type: 'unknown',
				isFallback: false,
				connectionTime: 0,
			};

			this.logger.info(`${LOG_PREFIXES.MANAGER} Storage system disconnected`);
		}
	}

	/**
	 * Perform health check on all backends
	 *
	 * @returns Health check results for each backend
	 */
	public async healthCheck(): Promise<HealthCheckResult> {
		// Implementation in Phase 5
		throw new Error('Not implemented yet - Phase 5');
	}

	// Private helper methods

	/**
	 * Create cache backend based on configuration
	 */
	private async createCacheBackend(): Promise<CacheBackend> {
		const config = this.config.cache;

		this.logger.debug(`${LOG_PREFIXES.CACHE} Creating backend`, { type: config.type });

		switch (config.type) {
			case BACKEND_TYPES.REDIS: {
				try {
					// Lazy load Redis module
					if (!StorageManager.redisModule) {
						this.logger.debug(`${LOG_PREFIXES.CACHE} Lazy loading Redis module`);
						const { RedisBackend } = await import('./backend/redis-backend.js');
						StorageManager.redisModule = RedisBackend;
					}

					const RedisBackend = StorageManager.redisModule;
					this.cacheMetadata.type = BACKEND_TYPES.REDIS;
					this.cacheMetadata.isFallback = false;

					return new RedisBackend(config);
				} catch (error) {
					this.logger.debug(`${LOG_PREFIXES.CACHE} Failed to create Redis backend`, {
						error: error instanceof Error ? error.message : String(error),
					});
					throw error; // Let connection handler deal with fallback
				}
			}

			case BACKEND_TYPES.IN_MEMORY:
			default: {
				// Use in-memory backend
				const { InMemoryBackend } = await import('./backend/in-memory.js');
				this.cacheMetadata.type = BACKEND_TYPES.IN_MEMORY;
				this.cacheMetadata.isFallback = false;

				return new InMemoryBackend();
			}
		}
	}

	/**
	 * Create database backend based on configuration
	 */
	private async createDatabaseBackend(): Promise<DatabaseBackend> {
		const config = this.config.database;

		this.logger.debug(`${LOG_PREFIXES.DATABASE} Creating backend`, { type: config.type });

		switch (config.type) {
			case BACKEND_TYPES.SQLITE: {
				try {
					// Lazy load SQLite module
					if (!StorageManager.sqliteModule) {
						this.logger.debug(`${LOG_PREFIXES.DATABASE} Lazy loading SQLite module`);
						const { SqliteBackend } = await import('./backend/sqlite.js');
						StorageManager.sqliteModule = SqliteBackend;
					}

					const SqliteBackend = StorageManager.sqliteModule;
					this.databaseMetadata.type = BACKEND_TYPES.SQLITE;
					this.databaseMetadata.isFallback = false;

					return new SqliteBackend(config);
				} catch (error) {
					this.logger.debug(`${LOG_PREFIXES.DATABASE} Failed to create SQLite backend`, {
						error: error instanceof Error ? error.message : String(error),
					});
					throw error; // Let connection handler deal with fallback
				}
			}

			case BACKEND_TYPES.POSTGRES: {
				try {
					// Lazy load PostgreSQL module
					if (!StorageManager.postgresModule) {
						this.logger.debug(`${LOG_PREFIXES.DATABASE} Lazy loading PostgreSQL module`);
						const { PostgresBackend } = await import('./backend/postgresql.js');
						StorageManager.postgresModule = PostgresBackend;
					}

					const PostgresBackend = StorageManager.postgresModule;
					this.databaseMetadata.type = BACKEND_TYPES.POSTGRES;
					this.databaseMetadata.isFallback = false;

					return new PostgresBackend(config);
				} catch (error) {
					this.logger.debug(`${LOG_PREFIXES.DATABASE} Failed to create PostgreSQL backend`, {
						error: error instanceof Error ? error.message : String(error),
					});
					throw error; // Let connection handler deal with fallback
				}
			}

			case BACKEND_TYPES.IN_MEMORY:
			default: {
				// Use in-memory backend
				const { InMemoryBackend } = await import('./backend/in-memory.js');
				this.databaseMetadata.type = BACKEND_TYPES.IN_MEMORY;
				this.databaseMetadata.isFallback = false;

				return new InMemoryBackend();
			}
		}
	}
}
