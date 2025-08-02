/**
 * Custom Collection Manager
 *
 * Manages multiple vector collections dynamically for custom memory types.
 * Built on top of the existing VectorStoreManager infrastructure.
 */

import { VectorStoreManager } from './manager.js';
import { VectorStore } from './backend/vector-store.js';
import type { VectorStoreConfig, VectorStoreResult, SearchFilters } from './types.js';
import { Logger, createLogger } from '../logger/index.js';
import { env } from '../env.js';
import { EventManager } from '../events/event-manager.js';
import type {
	// EmbeddingConfig,
	// VectorStoreConfig as CustomVectorStoreConfig,
	MemoryTypeConfig,
} from '../config/memory-config.schema.js';

/**
 * Information about a collection
 */
export interface CollectionInfo {
	name: string;
	connected: boolean;
	memoryTypeName: string;
	manager: VectorStoreManager;
	config: VectorStoreConfig;
	dimension: number;
	vectorCount?: number;
	lastAccessed?: Date;
}

/**
 * Collection health status
 */
export interface CollectionHealth {
	status: 'healthy' | 'degraded' | 'critical' | 'down';
	totalDocuments: number;
	indexStatus: string;
	lastUpdated: Date;
	errors: string[];
	warnings: string[];
	performance: {
		avgSearchTime: number;
		avgInsertTime: number;
		throughput: number;
	};
}

/**
 * Collection metrics for monitoring
 */
export interface CollectionMetrics {
	searchCount: number;
	insertCount: number;
	updateCount: number;
	deleteCount: number;
	errorCount: number;
	avgResponseTime: number;
	lastActive: Date;
	uptime: number;
}

/**
 * ID Range management for collections
 */
export interface IDRange {
	start: number;
	end: number;
	allocated: number;
	memoryTypeName: string;
}

/**
 * ID Range Manager for allocating unique ID ranges to memory types
 */
export class IDRangeManager {
	private allocatedRanges = new Map<string, IDRange>();
	private nextAvailableStart: number;
	private readonly rangeSize: number;
	private readonly logger: Logger;

	// Legacy ranges (preserved for compatibility)
	private static readonly LEGACY_RANGES = {
		KNOWLEDGE: { start: 1, end: 333333 },
		REFLECTION: { start: 666667, end: 999999 },
		SYSTEM_RESERVED: { start: 500000, end: 599999 },
		MIGRATION: { start: 600000, end: 666666 },
	};

	constructor(rangeSize: number = 100000) {
		this.rangeSize = rangeSize;
		this.nextAvailableStart = 1000000; // Start custom ranges at 1M
		this.logger = createLogger({
			level: env.CIPHER_LOG_LEVEL || 'info',
		});

		// Pre-allocate legacy ranges
		this.allocatedRanges.set('knowledge', {
			start: IDRangeManager.LEGACY_RANGES.KNOWLEDGE.start,
			end: IDRangeManager.LEGACY_RANGES.KNOWLEDGE.end,
			allocated: 0,
			memoryTypeName: 'knowledge',
		});

		this.allocatedRanges.set('reflection', {
			start: IDRangeManager.LEGACY_RANGES.REFLECTION.start,
			end: IDRangeManager.LEGACY_RANGES.REFLECTION.end,
			allocated: 0,
			memoryTypeName: 'reflection',
		});
	}

	/**
	 * Allocate an ID range for a memory type
	 */
	allocateRange(memoryTypeName: string): IDRange {
		if (this.allocatedRanges.has(memoryTypeName)) {
			return this.allocatedRanges.get(memoryTypeName)!;
		}

		const range: IDRange = {
			start: this.nextAvailableStart,
			end: this.nextAvailableStart + this.rangeSize - 1,
			allocated: 0,
			memoryTypeName,
		};

		this.allocatedRanges.set(memoryTypeName, range);
		this.nextAvailableStart += this.rangeSize;

		this.logger.info('IDRangeManager: Allocated ID range', {
			memoryTypeName,
			start: range.start,
			end: range.end,
			size: this.rangeSize,
		});

		return range;
	}

	/**
	 * Get the next available ID for a memory type
	 */
	getNextId(memoryTypeName: string): number {
		const range = this.allocatedRanges.get(memoryTypeName);
		if (!range) {
			throw new Error(`No ID range allocated for memory type: ${memoryTypeName}`);
		}

		const nextId = range.start + range.allocated;
		if (nextId > range.end) {
			throw new Error(`ID range exhausted for memory type: ${memoryTypeName}`);
		}

		range.allocated++;
		return nextId;
	}

	/**
	 * Validate that an ID belongs to the correct memory type
	 */
	validateID(id: number, memoryTypeName: string): boolean {
		const range = this.allocatedRanges.get(memoryTypeName);
		return range ? id >= range.start && id <= range.end : false;
	}

	/**
	 * Get range information for a memory type
	 */
	getRange(memoryTypeName: string): IDRange | null {
		return this.allocatedRanges.get(memoryTypeName) || null;
	}

	/**
	 * Get all allocated ranges
	 */
	getAllRanges(): Map<string, IDRange> {
		return new Map(this.allocatedRanges);
	}
}

/**
 * Custom Collection Manager
 *
 * Manages multiple vector collections for custom memory types.
 * Provides dynamic collection creation, deletion, and lifecycle management.
 */
export class CustomCollectionManager {
	private collections = new Map<string, VectorStoreManager>();
	private collectionConfigs = new Map<string, VectorStoreConfig>();
	private collectionMetrics = new Map<string, CollectionMetrics>();
	private readonly logger: Logger;
	private readonly idRangeManager: IDRangeManager;
	private eventManager?: EventManager;

	constructor(rangeSize?: number) {
		this.logger = createLogger({
			level: env.CIPHER_LOG_LEVEL || 'info',
		});
		this.idRangeManager = new IDRangeManager(rangeSize);

		this.logger.info('CustomCollectionManager: Initialized');
	}

	/**
	 * Set the event manager for emitting memory operation events
	 */
	setEventManager(eventManager: EventManager): void {
		this.eventManager = eventManager;
		// Propagate to existing collections
		for (const manager of this.collections.values()) {
			manager.setEventManager(eventManager);
		}
	}

	/**
	 * Create a new collection for a memory type
	 */
	async createCollection(memoryTypeConfig: MemoryTypeConfig): Promise<void> {
		const { name: memoryTypeName, collection_name: collectionName } = memoryTypeConfig;

		if (this.collections.has(collectionName)) {
			this.logger.warn('CustomCollectionManager: Collection already exists', {
				collectionName,
				memoryTypeName,
			});
			return;
		}

		// Allocate ID range for this memory type
		this.idRangeManager.allocateRange(memoryTypeName);

		// Convert custom config to VectorStoreConfig
		const vectorConfig: VectorStoreConfig = {
			type: env.VECTOR_STORE_TYPE,
			host: env.VECTOR_STORE_HOST,
			port: env.VECTOR_STORE_PORT,
			url: env.VECTOR_STORE_URL,
			apiKey: env.VECTOR_STORE_API_KEY,
			username: env.VECTOR_STORE_USERNAME,
			password: env.VECTOR_STORE_PASSWORD,
			collectionName,
			dimension: memoryTypeConfig.embedding.dimension,
			distance: env.VECTOR_STORE_DISTANCE,
			onDisk: env.VECTOR_STORE_ON_DISK,
			maxVectors: env.VECTOR_STORE_MAX_VECTORS,
		};

		// Create and configure the manager
		const manager = new VectorStoreManager(vectorConfig);
		if (this.eventManager) {
			manager.setEventManager(this.eventManager);
		}

		// Initialize metrics
		const metrics: CollectionMetrics = {
			searchCount: 0,
			insertCount: 0,
			updateCount: 0,
			deleteCount: 0,
			errorCount: 0,
			avgResponseTime: 0,
			lastActive: new Date(),
			uptime: Date.now(),
		};

		this.collections.set(collectionName, manager);
		this.collectionConfigs.set(collectionName, vectorConfig);
		this.collectionMetrics.set(collectionName, metrics);

		this.logger.info('CustomCollectionManager: Created collection', {
			collectionName,
			memoryTypeName,
			dimension: vectorConfig.dimension,
		});
	}

	/**
	 * Delete a collection
	 */
	async deleteCollection(collectionName: string): Promise<void> {
		const manager = this.collections.get(collectionName);
		if (!manager) {
			throw new Error(`Collection not found: ${collectionName}`);
		}

		try {
			// Disconnect and delete the collection
			await manager.disconnect();
			const store = manager.getStore();
			if (store) {
				await store.deleteCollection();
			}

			// Clean up our tracking
			this.collections.delete(collectionName);
			this.collectionConfigs.delete(collectionName);
			this.collectionMetrics.delete(collectionName);

			this.logger.info('CustomCollectionManager: Deleted collection', {
				collectionName,
			});
		} catch (error) {
			this.logger.error('CustomCollectionManager: Failed to delete collection', {
				collectionName,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Connect all collections
	 */
	async connectAll(): Promise<void> {
		this.logger.info('CustomCollectionManager: Connecting all collections...');

		const connectionPromises = Array.from(this.collections.entries()).map(
			async ([name, manager]) => {
				try {
					await manager.connect();
					this.logger.debug('CustomCollectionManager: Connected collection', { name });
				} catch (error) {
					this.logger.error('CustomCollectionManager: Failed to connect collection', {
						name,
						error: error instanceof Error ? error.message : String(error),
					});
					const metrics = this.collectionMetrics.get(name);
					if (metrics) {
						metrics.errorCount++;
					}
				}
			}
		);

		await Promise.allSettled(connectionPromises);
		this.logger.info('CustomCollectionManager: Connection phase completed');
	}

	/**
	 * Disconnect all collections
	 */
	async disconnectAll(): Promise<void> {
		this.logger.info('CustomCollectionManager: Disconnecting all collections...');

		const disconnectionPromises = Array.from(this.collections.values()).map(manager =>
			manager.disconnect()
		);

		await Promise.allSettled(disconnectionPromises);
		this.logger.info('CustomCollectionManager: All collections disconnected');
	}

	/**
	 * Get a vector store for a collection
	 */
	getStore(collectionName: string): VectorStore | null {
		const manager = this.collections.get(collectionName);
		return manager?.getStore() || null;
	}

	/**
	 * Get an event-aware vector store for a collection
	 */
	getEventAwareStore(collectionName: string, sessionId: string): VectorStore | null {
		const manager = this.collections.get(collectionName);
		return manager?.getEventAwareStore(sessionId) || null;
	}

	/**
	 * Store a vector in a collection with automatic ID assignment
	 */
	async store(
		collectionName: string,
		memoryTypeName: string,
		vector: number[],
		payload: Record<string, any>
	): Promise<string> {
		const store = this.getStore(collectionName);
		if (!store) {
			throw new Error(`Collection not found: ${collectionName}`);
		}

		const startTime = Date.now();
		const id = this.idRangeManager.getNextId(memoryTypeName);

		try {
			await store.insert([vector], [id], [payload]);

			// Update metrics
			const metrics = this.collectionMetrics.get(collectionName);
			if (metrics) {
				metrics.insertCount++;
				metrics.lastActive = new Date();
				this.updateResponseTime(metrics, Date.now() - startTime);
			}

			this.logger.debug('CustomCollectionManager: Stored vector', {
				collectionName,
				memoryTypeName,
				id,
			});

			return id.toString();
		} catch (error) {
			const metrics = this.collectionMetrics.get(collectionName);
			if (metrics) {
				metrics.errorCount++;
			}
			this.logger.error('CustomCollectionManager: Failed to store vector', {
				collectionName,
				memoryTypeName,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Search vectors in a collection
	 */
	async search(
		collectionName: string,
		query: number[],
		options: {
			limit?: number;
			filters?: SearchFilters;
		} = {}
	): Promise<VectorStoreResult[]> {
		const store = this.getStore(collectionName);
		if (!store) {
			throw new Error(`Collection not found: ${collectionName}`);
		}

		const startTime = Date.now();

		try {
			const results = await store.search(query, options.limit, options.filters);

			// Update metrics
			const metrics = this.collectionMetrics.get(collectionName);
			if (metrics) {
				metrics.searchCount++;
				metrics.lastActive = new Date();
				this.updateResponseTime(metrics, Date.now() - startTime);
			}

			this.logger.debug('CustomCollectionManager: Searched collection', {
				collectionName,
				resultCount: results.length,
				responseTime: Date.now() - startTime,
			});

			return results;
		} catch (error) {
			const metrics = this.collectionMetrics.get(collectionName);
			if (metrics) {
				metrics.errorCount++;
			}
			this.logger.error('CustomCollectionManager: Failed to search collection', {
				collectionName,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Update a vector in a collection
	 */
	async update(
		collectionName: string,
		id: string,
		vector: number[],
		payload: Record<string, any>
	): Promise<void> {
		const store = this.getStore(collectionName);
		if (!store) {
			throw new Error(`Collection not found: ${collectionName}`);
		}

		const startTime = Date.now();

		try {
			await store.update(parseInt(id), vector, payload);

			// Update metrics
			const metrics = this.collectionMetrics.get(collectionName);
			if (metrics) {
				metrics.updateCount++;
				metrics.lastActive = new Date();
				this.updateResponseTime(metrics, Date.now() - startTime);
			}

			this.logger.debug('CustomCollectionManager: Updated vector', {
				collectionName,
				id,
			});
		} catch (error) {
			const metrics = this.collectionMetrics.get(collectionName);
			if (metrics) {
				metrics.errorCount++;
			}
			this.logger.error('CustomCollectionManager: Failed to update vector', {
				collectionName,
				id,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Delete a vector from a collection
	 */
	async delete(collectionName: string, id: string): Promise<void> {
		const store = this.getStore(collectionName);
		if (!store) {
			throw new Error(`Collection not found: ${collectionName}`);
		}

		const startTime = Date.now();

		try {
			await store.delete(parseInt(id));

			// Update metrics
			const metrics = this.collectionMetrics.get(collectionName);
			if (metrics) {
				metrics.deleteCount++;
				metrics.lastActive = new Date();
				this.updateResponseTime(metrics, Date.now() - startTime);
			}

			this.logger.debug('CustomCollectionManager: Deleted vector', {
				collectionName,
				id,
			});
		} catch (error) {
			const metrics = this.collectionMetrics.get(collectionName);
			if (metrics) {
				metrics.errorCount++;
			}
			this.logger.error('CustomCollectionManager: Failed to delete vector', {
				collectionName,
				id,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Check if a collection is connected
	 */
	isConnected(collectionName: string): boolean {
		const manager = this.collections.get(collectionName);
		return manager?.isConnected() || false;
	}

	/**
	 * List all collections
	 */
	listCollections(): CollectionInfo[] {
		return Array.from(this.collections.entries()).map(([name, manager]) => {
			const config = this.collectionConfigs.get(name)!;
			const metrics = this.collectionMetrics.get(name);

			const collectionInfo: CollectionInfo = {
				name,
				connected: manager.isConnected(),
				memoryTypeName: this.findMemoryTypeByCollection(name),
				manager,
				config,
				dimension: config.dimension,
			};

			if (metrics?.lastActive) {
				collectionInfo.lastAccessed = metrics.lastActive;
			}

			return collectionInfo;
		});
	}

	/**
	 * Get collection health
	 */
	async getCollectionHealth(collectionName: string): Promise<CollectionHealth> {
		const manager = this.collections.get(collectionName);
		if (!manager) {
			throw new Error(`Collection not found: ${collectionName}`);
		}

		try {
			const health = await manager.healthCheck();
			const metrics = this.collectionMetrics.get(collectionName);

			return {
				status: health.overall ? 'healthy' : 'degraded',
				totalDocuments: 0, // TODO: Implement document counting
				indexStatus: manager.isConnected() ? 'ready' : 'disconnected',
				lastUpdated: new Date(),
				errors: [],
				warnings: [],
				performance: {
					avgSearchTime: metrics?.avgResponseTime || 0,
					avgInsertTime: metrics?.avgResponseTime || 0,
					throughput: this.calculateThroughput(metrics),
				},
			};
		} catch (error) {
			return {
				status: 'critical',
				totalDocuments: 0,
				indexStatus: 'error',
				lastUpdated: new Date(),
				errors: [error instanceof Error ? error.message : String(error)],
				warnings: [],
				performance: {
					avgSearchTime: 0,
					avgInsertTime: 0,
					throughput: 0,
				},
			};
		}
	}

	/**
	 * Get collection metrics
	 */
	getCollectionMetrics(collectionName: string): CollectionMetrics | null {
		return this.collectionMetrics.get(collectionName) || null;
	}

	/**
	 * Get ID range manager
	 */
	getIDRangeManager(): IDRangeManager {
		return this.idRangeManager;
	}

	/**
	 * Health check for all collections
	 */
	async healthCheck(): Promise<{
		overall: boolean;
		collections: Array<{
			name: string;
			health: CollectionHealth;
		}>;
	}> {
		const collectionHealths = await Promise.allSettled(
			Array.from(this.collections.keys()).map(async name => ({
				name,
				health: await this.getCollectionHealth(name),
			}))
		);

		const results = collectionHealths
			.filter(
				(result): result is PromiseFulfilledResult<{ name: string; health: CollectionHealth }> =>
					result.status === 'fulfilled'
			)
			.map(result => result.value);

		const overall = results.every(
			result => result.health.status === 'healthy' || result.health.status === 'degraded'
		);

		return {
			overall,
			collections: results,
		};
	}

	// Private helper methods

	private findMemoryTypeByCollection(collectionName: string): string {
		// This would need to be enhanced to track memory type -> collection mapping
		// For now, return the collection name as a fallback
		return collectionName.replace('_collection', '');
	}

	private updateResponseTime(metrics: CollectionMetrics, responseTime: number): void {
		// Simple moving average
		const totalOps =
			metrics.searchCount + metrics.insertCount + metrics.updateCount + metrics.deleteCount;
		if (totalOps === 1) {
			metrics.avgResponseTime = responseTime;
		} else {
			metrics.avgResponseTime =
				(metrics.avgResponseTime * (totalOps - 1) + responseTime) / totalOps;
		}
	}

	private calculateThroughput(metrics: CollectionMetrics | undefined): number {
		if (!metrics) return 0;

		const totalOps =
			metrics.searchCount + metrics.insertCount + metrics.updateCount + metrics.deleteCount;
		const uptimeSeconds = (Date.now() - metrics.uptime) / 1000;

		return uptimeSeconds > 0 ? totalOps / uptimeSeconds : 0;
	}
}
