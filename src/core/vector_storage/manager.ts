/**
 * Vector Storage Manager Implementation
 *
 * Orchestrates the vector storage system with backend management.
 * Provides lazy loading, graceful fallbacks, and connection management.
 *
 * @module vector_storage/manager
 */

import type { VectorStore, VectorStoreConfig } from './types.js';
import { VectorStoreSchema } from './config.js';
import { Logger, createLogger } from '../logger/index.js';
import { LOG_PREFIXES, ERROR_MESSAGES, TIMEOUTS, BACKEND_TYPES } from './constants.js';
import { EventManager } from '../events/event-manager.js';
import { ServiceEvents } from '../events/event-types.js';
import { EventAwareVectorStore } from './event-aware-store.js';

/**
 * Health check result for vector store backend
 */
export interface HealthCheckResult {
	backend: boolean;
	overall: boolean;
	details?: {
		backend?: { status: string; latency?: number; error?: string };
	};
}

/**
 * Vector storage system information
 */
export interface VectorStoreInfo {
	connected: boolean;
	backend: {
		type: string;
		connected: boolean;
		fallback: boolean;
		collectionName: string;
		dimension: number;
	};
	connectionAttempts: number;
	lastError: string | undefined;
}

/**
 * Vector Storage Manager
 *
 * Manages the lifecycle of vector storage backend with lazy loading and fallback support.
 * Follows the factory pattern with graceful degradation to in-memory storage.
 *
 * @example
 * ```typescript
 * const manager = new VectorStoreManager(config);
 * const store = await manager.connect();
 *
 * // Use vector store
 * await store.insert([vector], ['id1'], [{ title: 'Document' }]);
 * const results = await store.search(queryVector, 5);
 *
 * // Cleanup
 * await manager.disconnect();
 * ```
 */
export class VectorStoreManager {
	// Core state
	private store: VectorStore | undefined;
	private connected = false;
	private readonly config: VectorStoreConfig;
	private readonly logger: Logger;
	private eventManager?: EventManager;

	// Connection tracking
	private connectionAttempts = 0;
	private lastConnectionError?: Error;

	// Backend metadata
	private backendMetadata = {
		type: 'unknown',
		isFallback: false,
		connectionTime: 0,
	};

	// Lazy loading module references (static to share across instances)
	private static qdrantModule?: any;
	private static inMemoryModule?: any;
	private static milvusModule?: any;
	private static chromaModule?: any;
	private static pgVectorModule?: any;

	// In VectorStoreManager, track if in-memory is used as fallback or primary
	private usedFallback = false;
	private factoryFallback = false;

	/**
	 * Creates a new VectorStoreManager instance
	 *
	 * @param config - Vector storage configuration
	 * @throws {Error} If configuration is invalid
	 */
	constructor(config: VectorStoreConfig) {
		// Check for factory-level fallback marker before validation
		const configWithFallback = config as any;
		if (configWithFallback._fallbackFrom) {
			this.factoryFallback = true;
			this.usedFallback = true;
			// Remove the marker before validation
			delete configWithFallback._fallbackFrom;
		}

		// Validate configuration using Zod schema
		const validationResult = VectorStoreSchema.safeParse(config);
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

		// Use debug level to reduce redundant logging when used in dual collection setup
		this.logger.debug(`${LOG_PREFIXES.MANAGER} Initialized with configuration`, {
			type: this.config.type,
			collection: this.config.collectionName,
			dimension: this.config.dimension,
			fallback: this.usedFallback,
		});
	}

	/**
	 * Set the event manager for emitting memory operation events
	 */
	setEventManager(eventManager: EventManager): void {
		this.eventManager = eventManager;
	}

	/**
	 * Get the current vector storage configuration
	 *
	 * @returns The vector storage configuration
	 */
	public getConfig(): Readonly<VectorStoreConfig> {
		return this.config;
	}

	/**
	 * Get information about the vector storage system
	 *
	 * @returns Vector storage system information including connection status and backend type
	 */
	public getInfo(): VectorStoreInfo {
		return {
			connected: this.connected,
			backend: {
				type: this.backendMetadata.type,
				connected: this.store?.isConnected() ?? false,
				fallback: this.usedFallback,
				collectionName: this.config.collectionName,
				dimension: this.config.dimension,
			},
			connectionAttempts: this.connectionAttempts,
			lastError: this.lastConnectionError?.message,
		};
	}

	/**
	 * Get the current vector store if connected
	 *
	 * @returns The vector store or null if not connected
	 */
	public getStore(): VectorStore | null {
		if (!this.connected || !this.store) {
			return null;
		}

		return this.store;
	}

	/**
	 * Get an event-aware vector store for a specific session
	 *
	 * @param sessionId - The session ID to associate with memory operations
	 * @returns Event-aware vector store or null if not connected
	 */
	public getEventAwareStore(sessionId: string): VectorStore | null {
		if (!this.connected || !this.store) {
			return null;
		}

		// Return event-aware wrapper if EventManager is available
		if (this.eventManager) {
			return new EventAwareVectorStore(this.store, this.eventManager, sessionId);
		}

		// Fallback to regular store if no event manager
		return this.store;
	}

	/**
	 * Check if the vector storage manager is connected
	 *
	 * @returns true if backend is connected
	 */
	public isConnected(): boolean {
		return this.connected && this.store?.isConnected() === true;
	}

	/**
	 * Connect to vector storage backend
	 *
	 * @returns The connected vector store
	 * @throws {VectorStoreConnectionError} If backend fails to connect
	 */
	public async connect(): Promise<VectorStore> {
		// Reset runtime fallback flag but preserve factory fallback
		if (!this.factoryFallback) {
			this.usedFallback = false;
		}
		// Check if already connected
		if (this.connected && this.store) {
			this.logger.debug(`${LOG_PREFIXES.MANAGER} Already connected`, {
				type: this.backendMetadata.type,
			});

			return this.store;
		}

		this.connectionAttempts++;
		this.logger.debug(
			`${LOG_PREFIXES.MANAGER} Starting connection attempt ${this.connectionAttempts} for ${this.config.collectionName}`
		);

		try {
			// Create and connect backend
			const startTime = Date.now();
			try {
				this.store = await this.createBackend();
				await this.store.connect();
				// Only reset fallback flag if this wasn't a factory-level fallback
				if (!this.factoryFallback) {
					this.usedFallback = false; // Not a fallback if primary backend succeeded
				}

				this.logger.debug(`${LOG_PREFIXES.MANAGER} Connected to ${this.config.collectionName}`, {
					type: this.backendMetadata.type,
					isFallback: this.backendMetadata.isFallback,
					connectionTime: `${this.backendMetadata.connectionTime}ms`,
				});
			} catch (backendError) {
				// If the configured backend fails, try fallback to in-memory
				this.logger.warn(`${LOG_PREFIXES.MANAGER} Backend connection failed, attempting fallback`, {
					error: backendError instanceof Error ? backendError.message : String(backendError),
					originalType: this.config.type,
				});

				if (this.config.type !== BACKEND_TYPES.IN_MEMORY) {
					const { InMemoryBackend } = await import('./backend/in-memory.js');
					this.store = new InMemoryBackend({
						type: 'in-memory',
						collectionName: this.config.collectionName,
						dimension: this.config.dimension,
						maxVectors: 10000,
					});
					await this.store.connect();
					this.backendMetadata.type = BACKEND_TYPES.IN_MEMORY;
					this.backendMetadata.isFallback = true;
					this.backendMetadata.connectionTime = Date.now() - startTime;
					this.usedFallback = true; // Mark as fallback

					this.logger.info(`${LOG_PREFIXES.MANAGER} Connected to fallback backend`, {
						type: this.backendMetadata.type,
						originalType: this.config.type,
					});
				} else {
					// In-memory is primary, not a fallback (unless factory fallback)
					if (!this.factoryFallback) {
						this.usedFallback = false;
					}
					throw backendError; // Re-throw if already using in-memory
				}
			}

			this.connected = true;

			// Emit vector store connected event
			if (this.eventManager) {
				this.eventManager.emitServiceEvent(ServiceEvents.VECTOR_STORE_CONNECTED, {
					provider: this.backendMetadata.type,
					timestamp: Date.now(),
				});
			}

			this.logger.info(`${LOG_PREFIXES.MANAGER} Vector storage system connected`, {
				backend: this.backendMetadata.type,
				totalConnectionTime: `${this.backendMetadata.connectionTime}ms`,
			});

			return this.store!;
		} catch (error) {
			// Store error for reporting
			this.lastConnectionError = error as Error;

			// Disconnect any successfully connected backend
			if (this.store?.isConnected()) {
				await this.store.disconnect().catch(err =>
					this.logger.error(`${LOG_PREFIXES.MANAGER} Error during cleanup disconnect`, {
						error: err,
					})
				);
			}

			// Reset state
			this.store = undefined;
			this.connected = false;
			this.usedFallback = false;

			throw error;
		}
	}

	/**
	 * Disconnect from vector storage backend
	 */
	public async disconnect(): Promise<void> {
		if (!this.connected) {
			this.logger.debug(`${LOG_PREFIXES.MANAGER} Already disconnected`);
			return;
		}

		this.logger.info(`${LOG_PREFIXES.MANAGER} Disconnecting vector storage backend`);

		try {
			if (this.store?.isConnected()) {
				await Promise.race([
					this.store.disconnect(),
					new Promise((_, reject) =>
						setTimeout(() => reject(new Error('Disconnect timeout')), TIMEOUTS.SHUTDOWN)
					),
				]);

				// Emit vector store disconnected event
				if (this.eventManager) {
					this.eventManager.emitServiceEvent(ServiceEvents.VECTOR_STORE_DISCONNECTED, {
						provider: this.backendMetadata.type,
						reason: 'Normal disconnection',
						timestamp: Date.now(),
					});
				}

				this.logger.info(`${LOG_PREFIXES.MANAGER} Disconnected successfully`);
			}
		} catch (error) {
			// Emit vector store error event
			if (this.eventManager) {
				this.eventManager.emitServiceEvent(ServiceEvents.VECTOR_STORE_ERROR, {
					provider: this.backendMetadata.type,
					error: error instanceof Error ? error.message : String(error),
					timestamp: Date.now(),
				});
			}

			this.logger.error(`${LOG_PREFIXES.MANAGER} Disconnect error`, { error });
			throw error;
		} finally {
			// Always clean up state
			this.store = undefined;
			this.connected = false;
			this.usedFallback = false;

			// Reset metadata
			this.backendMetadata = {
				type: 'unknown',
				isFallback: false,
				connectionTime: 0,
			};

			this.logger.info(`${LOG_PREFIXES.MANAGER} Vector storage system disconnected`);
		}
	}

	/**
	 * Perform health check on the backend
	 *
	 * @returns Health check results
	 */
	public async healthCheck(): Promise<HealthCheckResult> {
		if (!this.connected || !this.store) {
			return {
				backend: false,
				overall: false,
				details: {
					backend: { status: 'not_connected' },
				},
			};
		}

		this.logger.debug(`${LOG_PREFIXES.MANAGER} Performing health check`);

		try {
			const startTime = Date.now();

			// Test basic operations
			const isConnected = this.store.isConnected();
			const latency = Date.now() - startTime;

			const result = {
				backend: isConnected,
				overall: isConnected,
				details: {
					backend: {
						status: isConnected ? 'healthy' : 'unhealthy',
						latency,
					},
				},
			};

			this.logger.info(`${LOG_PREFIXES.MANAGER} Health check completed`, {
				overall: result.overall,
				latency: `${latency}ms`,
			});

			return result;
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MANAGER} Health check failed`, { error });

			return {
				backend: false,
				overall: false,
				details: {
					backend: {
						status: 'error',
						error: error instanceof Error ? error.message : String(error),
					},
				},
			};
		}
	}

	// Private helper methods

	/**
	 * Create vector store backend based on configuration
	 */
	private async createBackend(): Promise<VectorStore> {
		const config = this.config;

		switch (config.type) {
			case BACKEND_TYPES.QDRANT: {
				try {
					// Lazy load Qdrant module
					if (!VectorStoreManager.qdrantModule) {
						this.logger.debug(`${LOG_PREFIXES.MANAGER} Lazy loading Qdrant module`);
						const { QdrantBackend } = await import('./backend/qdrant.js');
						VectorStoreManager.qdrantModule = QdrantBackend;
					}

					const QdrantBackend = VectorStoreManager.qdrantModule;
					this.backendMetadata.type = BACKEND_TYPES.QDRANT;
					this.backendMetadata.isFallback = false;

					return new QdrantBackend(config);
				} catch (error) {
					this.logger.debug(`${LOG_PREFIXES.MANAGER} Failed to create Qdrant backend`, {
						error: error instanceof Error ? error.message : String(error),
					});
					throw error; // Let connection handler deal with fallback
				}
			}

			case BACKEND_TYPES.MILVUS: {
				try {
					// Lazy load Milvus module (shared across all instances)
					if (!VectorStoreManager.milvusModule) {
						this.logger.debug(`${LOG_PREFIXES.MANAGER} Lazy loading Milvus module`);
						const { MilvusBackend } = await import('./backend/milvus.js');
						VectorStoreManager.milvusModule = MilvusBackend;
					}

					const MilvusBackend = VectorStoreManager.milvusModule;
					this.backendMetadata.type = BACKEND_TYPES.MILVUS;
					this.backendMetadata.isFallback = false;

					return new MilvusBackend(config);
				} catch (error) {
					this.logger.info(`${LOG_PREFIXES.MANAGER} Failed to create Milvus backend: ${error}`, {
						error: error instanceof Error ? error.message : String(error),
					});
					throw error; // Let connection handler deal with fallback
				}
			}

			case BACKEND_TYPES.CHROMA: {
				try {
					// Lazy load ChromaDB module (shared across all instances)
					if (!VectorStoreManager.chromaModule) {
						this.logger.debug(`${LOG_PREFIXES.MANAGER} Lazy loading ChromaDB module`);
						const { ChromaBackend } = await import('./backend/chroma.js');
						VectorStoreManager.chromaModule = ChromaBackend;
					}

					const ChromaBackend = VectorStoreManager.chromaModule;
					this.backendMetadata.type = BACKEND_TYPES.CHROMA;
					this.backendMetadata.isFallback = false;

					return new ChromaBackend(config);
				} catch (error) {
					this.logger.info(`${LOG_PREFIXES.MANAGER} Failed to create ChromaDB backend: ${error}`, {
						error: error instanceof Error ? error.message : String(error),
					});
					throw error; // Let connection handler deal with fallback
				}
			}

			case BACKEND_TYPES.PGVECTOR: {
				// Lazy load PgVector module
				if (!VectorStoreManager.pgVectorModule) {
					this.logger.debug(`${LOG_PREFIXES.MANAGER} Lazy loading PgVector module`);
					const { PgVectorBackend } = await import('./backend/pgvector.js');
					VectorStoreManager.pgVectorModule = PgVectorBackend;
				}

				const PgVectorBackend = VectorStoreManager.pgVectorModule;
				this.backendMetadata.type = BACKEND_TYPES.PGVECTOR;
				this.backendMetadata.isFallback = false;

				return new PgVectorBackend(config);
			}

			case BACKEND_TYPES.IN_MEMORY:
			default: {
				// Use in-memory backend
				if (!VectorStoreManager.inMemoryModule) {
					this.logger.debug(`${LOG_PREFIXES.MANAGER} Lazy loading in-memory module`);
					const { InMemoryBackend } = await import('./backend/in-memory.js');
					VectorStoreManager.inMemoryModule = InMemoryBackend;
				}

				const InMemoryBackend = VectorStoreManager.inMemoryModule;
				this.backendMetadata.type = BACKEND_TYPES.IN_MEMORY;
				this.backendMetadata.isFallback = false;

				return new InMemoryBackend(config);
			}
		}
	}
}
