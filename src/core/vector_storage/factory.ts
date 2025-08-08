/**
 * Vector Storage Factory
 *
 * Factory functions for creating and initializing the vector storage system.
 * Provides a simplified API for common vector storage setup patterns.
 *
 * @module vector_storage/factory
 */

import { VectorStoreManager } from './manager.js';
import { DualCollectionVectorManager } from './dual-collection-manager.js';
import type { VectorStoreConfig } from './types.js';
import { VectorStore } from './backend/vector-store.js';
import { createLogger } from '../logger/index.js';
import { LOG_PREFIXES } from './constants.js';
import { env } from '../env.js';
import { getServiceCache, createServiceKey } from '../brain/memory/service-cache.js';

/**
 * Factory result containing both the manager and vector store
 */
export interface VectorStoreFactory {
	/** The vector store manager instance for lifecycle control */
	manager: VectorStoreManager;
	/** The connected vector store ready for use */
	store: VectorStore;
}

/**
 * Dual collection factory result containing dual manager and stores
 */
export interface DualCollectionVectorFactory {
	/** The dual collection manager instance for lifecycle control */
	manager: DualCollectionVectorManager;
	/** The knowledge vector store ready for use */
	knowledgeStore: VectorStore;
	/** The reflection vector store ready for use (null if disabled) */
	reflectionStore: VectorStore | null;
}

/**
 * Creates and connects vector storage backend
 *
 * This is the primary factory function for initializing the vector storage system.
 * It creates a VectorStoreManager, connects to the configured backend, and
 * returns both the manager and the connected vector store.
 *
 * @param config - Vector storage configuration
 * @returns Promise resolving to manager and connected vector store
 * @throws {VectorStoreConnectionError} If connection fails and no fallback is available
 *
 * @example
 * ```typescript
 * // Basic usage with Qdrant
 * const { manager, store } = await createVectorStore({
 *   type: 'qdrant',
 *   host: 'localhost',
 *   port: 6333,
 *   collectionName: 'documents',
 *   dimension: 1536
 * });
 *
 * // Use the vector store
 * await store.insert([vector], ['doc1'], [{ title: 'Document' }]);
 * const results = await store.search(queryVector, 5);
 *
 * // Cleanup when done
 * await manager.disconnect();
 * ```
 *
 * @example
 * ```typescript
 * // Development configuration with in-memory
 * const { manager, store } = await createVectorStore({
 *   type: 'in-memory',
 *   collectionName: 'test',
 *   dimension: 1536,
 *   maxVectors: 1000
 * });
 * ```
 */
export async function createVectorStore(config: VectorStoreConfig): Promise<VectorStoreFactory> {
	const logger = createLogger({ level: env.CIPHER_LOG_LEVEL });

	logger.debug(`${LOG_PREFIXES.FACTORY} Creating vector storage system`, {
		type: config.type,
		collection: config.collectionName,
		dimension: config.dimension,
	});

	// Create manager
	const manager = new VectorStoreManager(config);

	try {
		// Connect to backend
		const store = await manager.connect();

		logger.info(`${LOG_PREFIXES.FACTORY} Vector storage system created successfully`, {
			type: manager.getInfo().backend.type,
			collection: config.collectionName,
			connected: manager.isConnected(),
		});

		return { manager, store };
	} catch (error) {
		// If connection fails, ensure cleanup
		await manager.disconnect().catch(() => {
			// Ignore disconnect errors during cleanup
		});

		logger.error(`${LOG_PREFIXES.FACTORY} Failed to create vector storage system`, {
			error: error instanceof Error ? error.message : String(error),
		});

		throw error;
	}
}

/**
 * Creates vector storage with default configuration
 *
 * Convenience function that creates vector storage with in-memory backend.
 * Useful for testing or development environments.
 *
 * @param collectionName - Optional collection name (default: 'default')
 * @param dimension - Optional vector dimension (default: 1536)
 * @returns Promise resolving to manager and connected vector store
 *
 * @example
 * ```typescript
 * const { manager, store } = await createDefaultVectorStore();
 * // Uses in-memory backend with default settings
 *
 * const { manager, store } = await createDefaultVectorStore('my_collection', 768);
 * // Uses in-memory backend with custom collection and dimension
 * ```
 */
export async function createDefaultVectorStore(
	collectionName: string = 'default',
	dimension: number = 1536
): Promise<VectorStoreFactory> {
	return createVectorStore({
		type: 'in-memory',
		collectionName,
		dimension,
		maxVectors: 10000,
	});
}

/**
 * Creates vector storage from environment variables
 *
 * Reads vector storage configuration from environment variables and creates
 * the vector storage system. Falls back to in-memory if not configured.
 *
 * Environment variables:
 * - VECTOR_STORE_TYPE: Backend type (qdrant, in-memory)
 * - VECTOR_STORE_HOST: Qdrant host (if using Qdrant)
 * - VECTOR_STORE_PORT: Qdrant port (if using Qdrant)
 * - VECTOR_STORE_URL: Qdrant URL (if using Qdrant)
 * - VECTOR_STORE_API_KEY: Qdrant API key (if using Qdrant)
 * - VECTOR_STORE_COLLECTION: Collection name
 * - VECTOR_STORE_DIMENSION: Vector dimension
 * - VECTOR_STORE_DISTANCE: Distance metric for Qdrant
 * - VECTOR_STORE_ON_DISK: Store vectors on disk (if using Qdrant)
 * - VECTOR_STORE_MAX_VECTORS: Maximum vectors for in-memory storage
 *
 * @param agentConfig - Optional agent configuration to override dimension from embedding config
 * @returns Promise resolving to manager and connected vector store
 *
 * @example
 * ```typescript
 * // Set environment variables
 * process.env.VECTOR_STORE_TYPE = 'qdrant';
 * process.env.VECTOR_STORE_HOST = 'localhost';
 * process.env.VECTOR_STORE_COLLECTION = 'documents';
 *
 * const { manager, store } = await createVectorStoreFromEnv();
 * ```
 */
export async function createVectorStoreFromEnv(agentConfig?: any): Promise<VectorStoreFactory> {
	const logger = createLogger({ level: env.CIPHER_LOG_LEVEL });

	// Get configuration from environment variables
	const config = getVectorStoreConfigFromEnv(agentConfig);

	logger.info(`${LOG_PREFIXES.FACTORY} Creating vector storage from environment`, {
		type: config.type,
		collection: config.collectionName,
		dimension: config.dimension,
	});

	return createVectorStore(config);
}

/**
 * Creates dual collection vector storage from environment variables
 *
 * Creates a dual collection manager that handles both knowledge and reflection
 * memory collections. Reflection collection is only created if REFLECTION_VECTOR_STORE_COLLECTION
 * is set and the model supports reasoning.
 *
 * @param agentConfig - Optional agent configuration to override dimension from embedding config
 * @returns Promise resolving to dual collection manager and stores
 *
 * @example
 * ```typescript
 * // Set environment variables for reasoning model with dual collections
 * process.env.VECTOR_STORE_TYPE = 'in-memory';
 * process.env.VECTOR_STORE_COLLECTION = 'knowledge';
 * process.env.REFLECTION_VECTOR_STORE_COLLECTION = 'reflection_memory';
 *
 * const { manager, knowledgeStore, reflectionStore } = await createDualCollectionVectorStoreFromEnv();
 * ```
 */
export async function createDualCollectionVectorStoreFromEnv(
	agentConfig?: any
): Promise<DualCollectionVectorFactory> {
	const logger = createLogger({ level: env.CIPHER_LOG_LEVEL });

	// Get base configuration from environment variables
	const config = getVectorStoreConfigFromEnv(agentConfig);

	// Use ServiceCache to prevent duplicate dual collection vector store creation
	const serviceCache = getServiceCache();
	const cacheKey = createServiceKey('dualCollectionVectorStore', {
		type: config.type,
		collection: config.collectionName,
		reflectionCollection: env.REFLECTION_VECTOR_STORE_COLLECTION || '',
		// Include dimension for proper cache key differentiation
		dimension: config.dimension,
	});

	return await serviceCache.getOrCreate(cacheKey, async () => {
		logger.debug('Creating new dual collection vector store instance');
		return await createDualCollectionVectorStoreInternal(config, logger);
	});
}

async function createDualCollectionVectorStoreInternal(
	config: VectorStoreConfig,
	logger: any
): Promise<DualCollectionVectorFactory> {
	// If reflection collection is not set or is empty/whitespace, treat as disabled
	const reflectionCollection = (env.REFLECTION_VECTOR_STORE_COLLECTION || '').trim();
	if (!reflectionCollection) {
		logger.info(
			`${LOG_PREFIXES.FACTORY} Reflection collection not set, creating single collection manager only`,
			{
				type: config.type,
				knowledgeCollection: config.collectionName,
			}
		);
		const manager = new DualCollectionVectorManager(config);
		await manager.connect();
		const knowledgeStore = manager.getStore('knowledge');
		if (!knowledgeStore) {
			throw new Error('Failed to get knowledge store from dual collection manager');
		}
		return {
			manager,
			knowledgeStore,
			reflectionStore: null,
		};
	}

	logger.info(`${LOG_PREFIXES.FACTORY} Creating dual collection vector storage from environment`, {
		type: config.type,
		knowledgeCollection: config.collectionName,
		reflectionCollection,
		refectionEnabled: true,
	});

	// Create dual collection manager
	const manager = new DualCollectionVectorManager(config);

	try {
		await manager.connect();

		const knowledgeStore = manager.getStore('knowledge');
		const reflectionStore = manager.getStore('reflection');

		if (!knowledgeStore) {
			throw new Error('Failed to get knowledge store from dual collection manager');
		}

		return {
			manager,
			knowledgeStore,
			reflectionStore,
		};
	} catch (error) {
		// If connection fails, ensure cleanup
		await manager.disconnect().catch(() => {
			// Ignore disconnect errors during cleanup
		});

		logger.error(`${LOG_PREFIXES.FACTORY} Failed to create dual collection vector storage system`, {
			error: error instanceof Error ? error.message : String(error),
		});

		throw error;
	}
}

/**
 * Get vector storage configuration from environment variables
 *
 * Returns the configuration object that would be used by createVectorStoreFromEnv
 * without actually creating the vector store. Useful for debugging and validation.
 *
 * @param agentConfig - Optional agent configuration to override dimension from embedding config
 * @returns Vector storage configuration based on environment variables
 *
 * @example
 * ```typescript
 * const config = getVectorStoreConfigFromEnv();
 * console.log('Vector store configuration:', config);
 *
 * // Then use the config to create the store
 * const { manager, store } = await createVectorStore(config);
 * ```
 */
export function getVectorStoreConfigFromEnv(agentConfig?: any): VectorStoreConfig {
	const logger = createLogger({ level: env.CIPHER_LOG_LEVEL });

	// Get configuration from centralized env object with fallbacks for invalid values
	const storeType = env.VECTOR_STORE_TYPE;
	const collectionName = env.VECTOR_STORE_COLLECTION;
	let dimension = Number.isNaN(env.VECTOR_STORE_DIMENSION) ? 1536 : env.VECTOR_STORE_DIMENSION;
	const maxVectors = Number.isNaN(env.VECTOR_STORE_MAX_VECTORS)
		? 10000
		: env.VECTOR_STORE_MAX_VECTORS;

	// Override dimension from agent config if embedding configuration is present
	if (
		agentConfig?.embedding &&
		typeof agentConfig.embedding === 'object' &&
		agentConfig.embedding.dimensions
	) {
		const embeddingDimension = agentConfig.embedding.dimensions;
		if (typeof embeddingDimension === 'number' && embeddingDimension > 0) {
			logger.debug('Overriding vector store dimension from agent config', {
				envDimension: dimension,
				agentDimension: embeddingDimension,
				embeddingType: agentConfig.embedding.type,
			});
			dimension = embeddingDimension;
		}
	}

	if (storeType === 'qdrant') {
		const host = env.VECTOR_STORE_HOST;
		const url = env.VECTOR_STORE_URL;
		const port = Number.isNaN(env.VECTOR_STORE_PORT) ? undefined : env.VECTOR_STORE_PORT;
		const apiKey = env.VECTOR_STORE_API_KEY;
		const distance = env.VECTOR_STORE_DISTANCE;
		const onDisk = env.VECTOR_STORE_ON_DISK;

		if (!url && !host) {
			// Return in-memory config with fallback marker
			return {
				type: 'in-memory',
				collectionName,
				dimension,
				maxVectors,
				// Add a special property to indicate this is a fallback from Qdrant
				_fallbackFrom: 'qdrant',
			} as any;
		}

		return {
			type: 'qdrant',
			collectionName,
			dimension,
			url,
			host,
			port,
			apiKey,
			distance,
			onDisk,
		};
	} else if ((storeType as string) === 'milvus') {
		const host = env.VECTOR_STORE_HOST;
		const url = env.VECTOR_STORE_URL;
		const port = Number.isNaN(env.VECTOR_STORE_PORT) ? undefined : env.VECTOR_STORE_PORT;
		const username = env.VECTOR_STORE_USERNAME;
		const password = env.VECTOR_STORE_PASSWORD;
		const token = env.VECTOR_STORE_API_KEY;

		if (!url && !host) {
			// Return in-memory config with fallback marker
			return {
				type: 'in-memory',
				collectionName,
				dimension,
				maxVectors,
				// Add a special property to indicate this is a fallback from Milvus
				_fallbackFrom: 'milvus',
			} as any;
		}

		return {
			type: 'milvus',
			collectionName,
			dimension,
			url,
			host,
			port,
			username,
			password,
			token,
		};
	} else if ((storeType as string) === 'chroma') {
		const host = env.VECTOR_STORE_HOST;
		const url = env.VECTOR_STORE_URL;
		const port = Number.isNaN(env.VECTOR_STORE_PORT) ? undefined : env.VECTOR_STORE_PORT;
		const headers = undefined; // Headers not currently supported in env vars
		// Map distance metrics from environment to ChromaDB format
		const envDistance = env.VECTOR_STORE_DISTANCE;
		let distance: 'cosine' | 'l2' | 'euclidean' | 'ip' | 'dot' = 'cosine';
		if (envDistance) {
			switch (envDistance.toLowerCase()) {
				case 'cosine':
					distance = 'cosine';
					break;
				case 'euclidean':
				case 'l2':
					distance = 'l2';
					break;
				case 'dot':
				case 'ip':
					distance = 'ip';
					break;
				default:
					distance = 'cosine';
			}
		}

		if (!url && !host) {
			// Return in-memory config with fallback marker
			return {
				type: 'in-memory',
				collectionName,
				dimension,
				maxVectors,
				// Add a special property to indicate this is a fallback from ChromaDB
				_fallbackFrom: 'chroma',
			} as any;
		}

		return {
			type: 'chroma',
			collectionName,
			dimension,
			url,
			host,
			port,
			headers,
			distance,
		};
	} else if (storeType === 'pgvector') {
		const url = env.VECTOR_STORE_URL;

		if (!url) {
			// Return in-memory config with fallback marker
			return {
				type: 'in-memory',
				collectionName,
				dimension,
				maxVectors,
				// Add a special property to indicate this is a fallback from PgVector
				_fallbackFrom: 'pgvector',
			} as any;
		}

		return {
			type: 'pgvector',
			collectionName,
			dimension,
			url,
		};
	} else {
		return {
			type: 'in-memory',
			collectionName,
			dimension,
			maxVectors,
		};
	}
}

/**
 * Get workspace memory vector storage configuration from environment variables
 *
 * Returns the configuration object for workspace memory vector store, using
 * workspace-specific environment variables with fallbacks to default vector store config.
 *
 * @param agentConfig - Optional agent configuration to override dimension from embedding config
 * @returns Vector storage configuration based on workspace memory environment variables
 *
 * @example
 * ```typescript
 * const config = getWorkspaceVectorStoreConfigFromEnv();
 * console.log('Workspace vector store configuration:', config);
 *
 * // Then use the config to create workspace store
 * const { manager, store } = await createVectorStore(config);
 * ```
 */
export function getWorkspaceVectorStoreConfigFromEnv(agentConfig?: any): VectorStoreConfig {
	const logger = createLogger({ level: env.CIPHER_LOG_LEVEL });

	// Get workspace-specific configuration with fallbacks to default vector store config
	const storeType = env.WORKSPACE_VECTOR_STORE_TYPE || env.VECTOR_STORE_TYPE;
	const collectionName = env.WORKSPACE_VECTOR_STORE_COLLECTION || 'workspace_memory';
	let dimension = Number.isNaN(env.WORKSPACE_VECTOR_STORE_DIMENSION)
		? Number.isNaN(env.VECTOR_STORE_DIMENSION)
			? 1536
			: env.VECTOR_STORE_DIMENSION
		: env.WORKSPACE_VECTOR_STORE_DIMENSION;
	const maxVectors = Number.isNaN(env.WORKSPACE_VECTOR_STORE_MAX_VECTORS)
		? Number.isNaN(env.VECTOR_STORE_MAX_VECTORS)
			? 10000
			: env.VECTOR_STORE_MAX_VECTORS
		: env.WORKSPACE_VECTOR_STORE_MAX_VECTORS;

	// Override dimension from agent config if embedding configuration is present
	if (
		agentConfig?.embedding &&
		typeof agentConfig.embedding === 'object' &&
		agentConfig.embedding.dimensions
	) {
		const embeddingDimension = agentConfig.embedding.dimensions;
		if (typeof embeddingDimension === 'number' && embeddingDimension > 0) {
			logger.debug('Overriding workspace vector store dimension from agent config', {
				envDimension: dimension,
				agentDimension: embeddingDimension,
				embeddingType: agentConfig.embedding.type,
			});
			dimension = embeddingDimension;
		}
	}

	logger.debug('Creating workspace vector store config', {
		storeType,
		collectionName,
		dimension,
		maxVectors,
		usingWorkspaceSpecificType: !!env.WORKSPACE_VECTOR_STORE_TYPE,
		usingWorkspaceSpecificCollection: !!env.WORKSPACE_VECTOR_STORE_COLLECTION,
	});

	if (storeType === 'qdrant') {
		const host = env.WORKSPACE_VECTOR_STORE_HOST || env.VECTOR_STORE_HOST;
		const url = env.WORKSPACE_VECTOR_STORE_URL || env.VECTOR_STORE_URL;
		const port = Number.isNaN(env.WORKSPACE_VECTOR_STORE_PORT)
			? Number.isNaN(env.VECTOR_STORE_PORT)
				? undefined
				: env.VECTOR_STORE_PORT
			: env.WORKSPACE_VECTOR_STORE_PORT;
		const apiKey = env.WORKSPACE_VECTOR_STORE_API_KEY || env.VECTOR_STORE_API_KEY;
		const distance = env.WORKSPACE_VECTOR_STORE_DISTANCE || env.VECTOR_STORE_DISTANCE;
		const onDisk = env.WORKSPACE_VECTOR_STORE_ON_DISK;

		if (!url && !host) {
			// Return in-memory config with fallback marker
			return {
				type: 'in-memory',
				collectionName,
				dimension,
				maxVectors,
				// Add a special property to indicate this is a fallback from Qdrant
				_fallbackFrom: 'qdrant-workspace',
			} as any;
		}

		return {
			type: 'qdrant',
			collectionName,
			dimension,
			url,
			host,
			port,
			apiKey,
			distance,
			onDisk,
		};
	} else if ((storeType as string) === 'milvus') {
		const host = env.WORKSPACE_VECTOR_STORE_HOST || env.VECTOR_STORE_HOST;
		const url = env.WORKSPACE_VECTOR_STORE_URL || env.VECTOR_STORE_URL;
		const port = Number.isNaN(env.WORKSPACE_VECTOR_STORE_PORT)
			? Number.isNaN(env.VECTOR_STORE_PORT)
				? undefined
				: env.VECTOR_STORE_PORT
			: env.WORKSPACE_VECTOR_STORE_PORT;
		const username = env.WORKSPACE_VECTOR_STORE_USERNAME || env.VECTOR_STORE_USERNAME;
		const password = env.WORKSPACE_VECTOR_STORE_PASSWORD || env.VECTOR_STORE_PASSWORD;
		const token = env.WORKSPACE_VECTOR_STORE_API_KEY || env.VECTOR_STORE_API_KEY;

		if (!url && !host) {
			// Return in-memory config with fallback marker
			return {
				type: 'in-memory',
				collectionName,
				dimension,
				maxVectors,
				// Add a special property to indicate this is a fallback from Milvus
				_fallbackFrom: 'milvus-workspace',
			} as any;
		}

		return {
			type: 'milvus',
			collectionName,
			dimension,
			url,
			host,
			port,
			username,
			password,
			token,
		};
	} else if ((storeType as string) === 'chroma') {
		const host = env.WORKSPACE_VECTOR_STORE_HOST || env.VECTOR_STORE_HOST;
		const url = env.WORKSPACE_VECTOR_STORE_URL || env.VECTOR_STORE_URL;
		const port = Number.isNaN(env.WORKSPACE_VECTOR_STORE_PORT)
			? Number.isNaN(env.VECTOR_STORE_PORT)
				? undefined
				: env.VECTOR_STORE_PORT
			: env.WORKSPACE_VECTOR_STORE_PORT;
		const headers = undefined; // Headers not currently supported in env vars
		// Map distance metrics from environment to ChromaDB format
		const envDistance = env.WORKSPACE_VECTOR_STORE_DISTANCE || env.VECTOR_STORE_DISTANCE;
		let distance: 'cosine' | 'l2' | 'euclidean' | 'ip' | 'dot' = 'cosine';
		if (envDistance) {
			switch (envDistance.toLowerCase()) {
				case 'cosine':
					distance = 'cosine';
					break;
				case 'euclidean':
				case 'l2':
					distance = 'l2';
					break;
				case 'dot':
				case 'ip':
					distance = 'ip';
					break;
				default:
					distance = 'cosine';
			}
		}

		if (!url && !host) {
			// Return in-memory config with fallback marker
			return {
				type: 'in-memory',
				collectionName,
				dimension,
				maxVectors,
				// Add a special property to indicate this is a fallback from ChromaDB
				_fallbackFrom: 'chroma-workspace',
			} as any;
		}

		return {
			type: 'chroma',
			collectionName,
			dimension,
			url,
			host,
			port,
			headers,
			distance,
		};
	} else if (storeType === 'pgvector') {
		const url = env.WORKSPACE_VECTOR_STORE_URL || env.VECTOR_STORE_URL;

		if (!url) {
			// Return in-memory config with fallback marker
			return {
				type: 'in-memory',
				collectionName,
				dimension,
				maxVectors,
				// Add a special property to indicate this is a fallback from PgVector
				_fallbackFrom: 'pgvector-workspace',
			} as any;
		}

		return {
			type: 'pgvector',
			collectionName,
			dimension,
			url,
		};
	} else {
		return {
			type: 'in-memory',
			collectionName,
			dimension,
			maxVectors,
		};
	}
}

/**
 * Multi Collection Vector Factory interface for workspace memory support
 */
export interface MultiCollectionVectorFactory {
	/** The multi collection manager instance */
	manager: any; // MultiCollectionVectorManager
	/** The knowledge vector store ready for use */
	knowledgeStore: VectorStore;
	/** The reflection vector store ready for use (null if disabled) */
	reflectionStore: VectorStore | null;
	/** The workspace vector store ready for use (null if disabled) */
	workspaceStore: VectorStore | null;
}

/**
 * Creates multi-collection vector storage from environment variables
 *
 * Creates a multi-collection manager that handles knowledge, reflection, and workspace
 * memory collections. This replaces DualCollectionVectorManager when workspace memory is enabled.
 *
 * @param agentConfig - Optional agent configuration to override dimension from embedding config
 * @returns Promise resolving to multi collection manager and stores
 */
export async function createMultiCollectionVectorStoreFromEnv(
	agentConfig?: any
): Promise<MultiCollectionVectorFactory> {
	const logger = createLogger({ level: env.CIPHER_LOG_LEVEL });

	// Import MultiCollectionVectorManager dynamically to avoid circular dependencies
	// const { MultiCollectionVectorManager } = await import('./multi-collection-manager.js'); // Not used in this scope

	// Get base configuration from environment variables
	const config = getVectorStoreConfigFromEnv(agentConfig);

	// Use ServiceCache to prevent duplicate multi collection vector store creation
	const serviceCache = getServiceCache();
	const cacheKey = createServiceKey('multiCollectionVectorStore', {
		type: config.type,
		collection: config.collectionName,
		reflectionCollection: env.REFLECTION_VECTOR_STORE_COLLECTION || '',
		workspaceCollection: env.WORKSPACE_VECTOR_STORE_COLLECTION || 'workspace_memory',
		workspaceEnabled: !!env.USE_WORKSPACE_MEMORY,
		// Include dimension for proper cache key differentiation
		dimension: config.dimension,
	});

	return await serviceCache.getOrCreate(cacheKey, async () => {
		logger.debug('Creating new multi collection vector store instance');
		return await createMultiCollectionVectorStoreInternal(config, logger);
	});
}

async function createMultiCollectionVectorStoreInternal(
	config: VectorStoreConfig,
	logger: any
): Promise<MultiCollectionVectorFactory> {
	// Import MultiCollectionVectorManager dynamically
	const { MultiCollectionVectorManager } = await import('./multi-collection-manager.js');

	logger.info(`${LOG_PREFIXES.FACTORY} Creating multi collection vector storage from environment`, {
		type: config.type,
		knowledgeCollection: config.collectionName,
		reflectionCollection: env.REFLECTION_VECTOR_STORE_COLLECTION || 'disabled',
		workspaceCollection: env.USE_WORKSPACE_MEMORY
			? env.WORKSPACE_VECTOR_STORE_COLLECTION || 'workspace_memory'
			: 'disabled',
		workspaceEnabled: !!env.USE_WORKSPACE_MEMORY,
	});

	// Create multi collection manager
	const manager = new MultiCollectionVectorManager(config);

	try {
		const connected = await manager.connect();

		if (!connected) {
			throw new Error('Failed to connect multi collection vector manager');
		}

		const knowledgeStore = manager.getStore('knowledge');
		const reflectionStore = manager.getStore('reflection');
		const workspaceStore = manager.getStore('workspace');

		if (!knowledgeStore) {
			throw new Error('Failed to get knowledge store from multi collection manager');
		}

		logger.info(`${LOG_PREFIXES.FACTORY} Multi collection vector storage created successfully`, {
			knowledge: !!knowledgeStore,
			reflection: !!reflectionStore,
			workspace: !!workspaceStore,
		});

		return {
			manager,
			knowledgeStore,
			reflectionStore,
			workspaceStore,
		};
	} catch (error) {
		// If connection fails, ensure cleanup
		await manager.disconnect().catch(() => {
			// Ignore disconnect errors during cleanup
		});

		logger.error(
			`${LOG_PREFIXES.FACTORY} Failed to create multi collection vector storage system`,
			{
				error: error instanceof Error ? error.message : String(error),
			}
		);

		throw error;
	}
}

/**
 * Creates workspace memory vector storage from environment variables
 *
 * Reads workspace memory vector storage configuration from environment variables and creates
 * the vector storage system specifically for workspace memory. Falls back to default
 * vector store configuration if workspace-specific variables are not set.
 *
 * Environment variables (with fallbacks to default VECTOR_STORE_* variables):
 * - WORKSPACE_VECTOR_STORE_TYPE: Backend type (qdrant, milvus, chroma, in-memory)
 * - WORKSPACE_VECTOR_STORE_HOST: Host (fallback to VECTOR_STORE_HOST)
 * - WORKSPACE_VECTOR_STORE_PORT: Port (fallback to VECTOR_STORE_PORT)
 * - WORKSPACE_VECTOR_STORE_URL: URL (fallback to VECTOR_STORE_URL)
 * - WORKSPACE_VECTOR_STORE_API_KEY: API key (fallback to VECTOR_STORE_API_KEY)
 * - WORKSPACE_VECTOR_STORE_COLLECTION: Collection name (default: workspace_memory)
 * - WORKSPACE_VECTOR_STORE_DIMENSION: Vector dimension (fallback to VECTOR_STORE_DIMENSION)
 * - WORKSPACE_VECTOR_STORE_DISTANCE: Distance metric for Qdrant (fallback to VECTOR_STORE_DISTANCE)
 * - WORKSPACE_VECTOR_STORE_ON_DISK: Store vectors on disk (default: false)
 * - WORKSPACE_VECTOR_STORE_MAX_VECTORS: Maximum vectors for in-memory storage
 *
 * @param agentConfig - Optional agent configuration to override dimension from embedding config
 * @returns Promise resolving to manager and connected workspace vector store
 *
 * @example
 * ```typescript
 * // Set workspace-specific environment variables
 * process.env.WORKSPACE_VECTOR_STORE_TYPE = 'milvus';
 * process.env.WORKSPACE_VECTOR_STORE_HOST = 'localhost';
 * process.env.WORKSPACE_VECTOR_STORE_COLLECTION = 'team_workspace';
 *
 * const { manager, store } = await createWorkspaceVectorStoreFromEnv();
 * ```
 */
export async function createWorkspaceVectorStoreFromEnv(
	agentConfig?: any
): Promise<VectorStoreFactory> {
	const logger = createLogger({ level: env.CIPHER_LOG_LEVEL });

	// Get workspace-specific configuration from environment variables
	const config = getWorkspaceVectorStoreConfigFromEnv(agentConfig);

	logger.info(`${LOG_PREFIXES.FACTORY} Creating workspace memory vector storage from environment`, {
		type: config.type,
		collection: config.collectionName,
		dimension: config.dimension,
		workspaceSpecific: config.collectionName !== env.VECTOR_STORE_COLLECTION,
	});

	return createVectorStore(config);
}

/**
 * Type guard to check if an object is a VectorStoreFactory
 *
 * @param obj - Object to check
 * @returns true if the object has manager and store properties
 */
export function isVectorStoreFactory(obj: unknown): obj is VectorStoreFactory {
	return (
		typeof obj === 'object' &&
		obj !== null &&
		'manager' in obj &&
		'store' in obj &&
		obj.manager instanceof VectorStoreManager
	);
}

/**
 * Check if Qdrant configuration is available in environment
 */
export function isQdrantConfigAvailable(): boolean {
	return !!(
		process.env.VECTOR_STORE_URL ||
		process.env.VECTOR_STORE_HOST ||
		process.env.VECTOR_STORE_PORT
	);
}
