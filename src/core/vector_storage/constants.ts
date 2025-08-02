/**
 * Vector Storage Module Constants
 *
 * Central location for all vector storage-related constants including
 * error messages, log prefixes, timeouts, and configuration defaults.
 *
 * @module vector_storage/constants
 */

/**
 * Log prefixes for consistent logging across the vector storage module
 */
export const LOG_PREFIXES = {
	MANAGER: '[VectorStoreManager]',
	QDRANT: '[VectorStore:Qdrant]',
	MILVUS: '[VectorStore:Milvus]',
	MEMORY: '[VectorStore:Memory]',
	ANN: '[VectorStore:ANN]',
	INDEX: '[VectorStore:Index]',
	SEARCH: '[VectorStore:Search]',
	BACKEND: '[VectorStore:Backend]',
	FACTORY: '[VectorStore:Factory]',
} as const;

/**
 * Error messages for the vector storage module
 */
export const ERROR_MESSAGES = {
	// Connection errors
	CONNECTION_FAILED: 'Failed to connect to vector store backend',
	ALREADY_CONNECTED: 'Vector store is already connected',
	NOT_CONNECTED: 'Vector store is not connected',

	// Backend errors
	BACKEND_NOT_FOUND: 'Vector store backend not found',
	INVALID_BACKEND_TYPE: 'Invalid backend type specified',
	MODULE_LOAD_FAILED: 'Failed to load backend module',

	// Operation errors
	INVALID_DIMENSION: 'Vector dimension mismatch',
	COLLECTION_NOT_FOUND: 'Collection does not exist',
	VECTOR_NOT_FOUND: 'Vector not found',
	BATCH_SIZE_EXCEEDED: 'Batch size exceeds maximum allowed',
	SEARCH_FAILED: 'Vector search operation failed',

	// Configuration errors
	INVALID_CONFIG: 'Invalid vector store configuration',
	MISSING_REQUIRED_CONFIG: 'Missing required configuration',
	INVALID_COLLECTION_NAME: 'Invalid collection name',
} as const;

/**
 * Vector storage operation timeouts (in milliseconds)
 */
export const TIMEOUTS = {
	CONNECTION: 30000, // 30 seconds (vector stores may take longer)
	OPERATION: 60000, // 60 seconds
	SEARCH: 10000, // 10 seconds
	SHUTDOWN: 5000, // 5 seconds
} as const;

/**
 * Backend type identifiers
 */
export const BACKEND_TYPES = {
	QDRANT: 'qdrant',
	IN_MEMORY: 'in-memory',
	MILVUS: 'milvus',
} as const;

/**
 * Default configuration values
 */
export const DEFAULTS = {
	// Search defaults
	SEARCH_LIMIT: 10,
	SEARCH_SCORE_THRESHOLD: 0.0,

	// Vector defaults
	DIMENSION: 1536, // OpenAI ada-002 dimension
	MAX_BATCH_SIZE: 100,

	// Connection defaults
	MAX_RETRIES: 3,
	RETRY_DELAY: 1000, // 1 second
	MAX_CONNECTIONS: 10,
	IDLE_TIMEOUT: 30000, // 30 seconds

	// Qdrant defaults
	QDRANT_PORT: 6333,
	QDRANT_GRPC_PORT: 6334,
	QDRANT_DISTANCE: 'Cosine' as const,

	// ANN defaults (limited to faiss-node support)
	ANN_MIN_DATASET_SIZE: 1000,
	ANN_ALGORITHM: 'flat' as const,

	// Persistence defaults
	PERSISTENCE_ENABLED: true,
	PERSISTENCE_PATH: './data/vector-storage',
} as const;

/**
 * Vector distance metrics
 */
export const DISTANCE_METRICS = {
	COSINE: 'Cosine',
	EUCLIDEAN: 'Euclidean',
	DOT_PRODUCT: 'Dot',
	MANHATTAN: 'Manhattan',
} as const;

/**
 * Vector storage metrics event names
 */
export const METRICS_EVENTS = {
	CONNECTION_ATTEMPT: 'vector_storage.connection.attempt',
	CONNECTION_SUCCESS: 'vector_storage.connection.success',
	CONNECTION_FAILURE: 'vector_storage.connection.failure',
	SEARCH_START: 'vector_storage.search.start',
	SEARCH_SUCCESS: 'vector_storage.search.success',
	SEARCH_FAILURE: 'vector_storage.search.failure',
	INDEX_START: 'vector_storage.index.start',
	INDEX_SUCCESS: 'vector_storage.index.success',
	INDEX_FAILURE: 'vector_storage.index.failure',
	COLLECTION_CREATED: 'vector_storage.collection.created',
	COLLECTION_DELETED: 'vector_storage.collection.deleted',
	ANN_SEARCH_START: 'vector_storage.ann.search.start',
	ANN_SEARCH_SUCCESS: 'vector_storage.ann.search.success',
	ANN_SEARCH_FAILURE: 'vector_storage.ann.search.failure',
	ANN_INDEX_BUILD_START: 'vector_storage.ann.index.build.start',
	ANN_INDEX_BUILD_SUCCESS: 'vector_storage.ann.index.build.success',
	ANN_INDEX_BUILD_FAILURE: 'vector_storage.ann.index.build.failure',
} as const;
