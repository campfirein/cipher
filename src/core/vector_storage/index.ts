/**
 * Vector Storage Module
 *
 * High-performance vector storage and similarity search for embeddings.
 * Supports multiple backends with a unified API.
 *
 * Features:
 * - Multiple backend support (Qdrant, In-Memory, etc.)
 * - Similarity search with metadata filtering
 * - Batch operations for efficient indexing
 * - Type-safe configuration with runtime validation
 * - Graceful fallback to in-memory storage
 *
 * @module vector_storage
 *
 * @example
 * ```typescript
 * import { createVectorStore } from './vector_storage';
 *
 * // Create a vector store
 * const { store, manager } = await createVectorStore({
 *   type: 'qdrant',
 *   host: 'localhost',
 *   port: 6333,
 *   collectionName: 'documents',
 *   dimension: 1536
 * });
 *
 * // Index vectors
 * await store.insert(
 *   [embedding1, embedding2],
 *   ['doc1', 'doc2'],
 *   [{ title: 'Doc 1' }, { title: 'Doc 2' }]
 * );
 *
 * // Search for similar vectors
 * const results = await store.search(queryEmbedding, 5);
 *
 * // Cleanup
 * await manager.disconnect();
 * ```
 */

// Export types
export type {
	VectorStore,
	VectorStoreResult,
	SearchFilters,
	VectorStoreConfig,
	BackendConfig,
} from './types.js';

// Export error classes
export {
	VectorStoreError,
	VectorStoreConnectionError,
	VectorDimensionError,
	CollectionNotFoundError,
} from './backend/types.js';

// Export factory functions
export {
	createVectorStore,
	createDefaultVectorStore,
	createVectorStoreFromEnv,
	createDualCollectionVectorStoreFromEnv,
	getVectorStoreConfigFromEnv,
	isVectorStoreFactory,
	type VectorStoreFactory,
	type DualCollectionVectorFactory,
} from './factory.js';

// Export managers
export { VectorStoreManager, type HealthCheckResult, type VectorStoreInfo } from './manager.js';
export { DualCollectionVectorManager, type CollectionType } from './dual-collection-manager.js';

// Export ANN components
export { ANNIndex, type ANNIndexConfig, type ANNAlgorithm, type ANNSearchResult, type ANNIndexStats } from './ann_index.js';
export { EnhancedInMemoryBackend, type EnhancedInMemoryConfig } from './backend/enhanced-in-memory.js';

// Export constants for external use
export { BACKEND_TYPES, DEFAULTS, DISTANCE_METRICS } from './constants.js';
