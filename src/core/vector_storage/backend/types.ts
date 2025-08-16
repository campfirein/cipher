/**
 * Vector Storage Backend Types and Error Classes
 *
 * This module defines the core types and error classes for the vector storage system.
 * The vector storage system provides similarity search capabilities for high-dimensional vectors.
 *
 * @module vector_storage/backend/types
 */

import type { VectorStore } from './vector-store.js';

// Re-export the vector store interface for convenience
export type { VectorStore };

// Re-export configuration types from the config module
export type {
	BackendConfig,
	VectorStoreConfig,
	InMemoryBackendConfig,
	QdrantBackendConfig,
	MilvusBackendConfig,
	ChromaBackendConfig,
	PgVectorBackendConfig,
	PineconeBackendConfig,
} from '../config.js';

/**
 * Search filters for vector queries
 *
 * Allows filtering search results based on metadata attached to vectors.
 * Supports exact matches and range queries.
 *
 * @example
 * ```typescript
 * const filters: SearchFilters = {
 *   category: 'documents',
 *   created_at: { gte: startDate, lte: endDate },
 *   tags: { any: ['important', 'reviewed'] }
 * };
 * ```
 */
export interface SearchFilters {
	[key: string]:
		| string
		| number
		| boolean
		| { gte?: number; gt?: number; lte?: number; lt?: number }
		| { any?: Array<string | number> }
		| { all?: Array<string | number> };
}

/**
 * Vector search result
 *
 * Represents a single result from a vector similarity search.
 * Includes the vector ID, similarity score, and associated metadata.
 *
 * @example
 * ```typescript
 * const result: VectorStoreResult = {
 *   id: 'doc-123', // or number for Qdrant
 *   score: 0.95,
 *   payload: {
 *     title: 'Important Document',
 *     category: 'reports',
 *     created_at: 1234567890
 *   }
 * };
 * ```
 */
export interface VectorStoreResult {
	/** Unique identifier for the vector - string for in-memory, number for Qdrant */
	id: string | number;

	/** Similarity score (higher is more similar, range depends on metric) */
	score?: number;

	/** Vector data (only returned if explicitly requested) */
	vector?: number[];

	/** Metadata associated with the vector */
	payload: Record<string, any>;
}

/**
 * Base Vector Storage Error Class
 *
 * All vector storage-related errors extend from this base class.
 * Provides consistent error structure with operation context and optional cause.
 *
 * @example
 * ```typescript
 * throw new VectorStoreError('Failed to index vectors', 'insert', originalError);
 * ```
 */
export class VectorStoreError extends Error {
	constructor(
		override message: string,
		/** The operation that failed (e.g., 'search', 'insert', 'delete', 'connection') */
		public readonly operation: string,
		/** The underlying error that caused this error, if any */
		public override readonly cause?: Error
	) {
		super(message);
		this.name = 'VectorStoreError';
		this.cause = cause;
	}
}

/**
 * Vector Store Connection Error
 *
 * Thrown when a vector store backend fails to connect or loses connection.
 * Includes the backend type for easier debugging.
 *
 * @example
 * ```typescript
 * throw new VectorStoreConnectionError(
 *   'Failed to connect to Qdrant',
 *   'qdrant',
 *   qdrantError
 * );
 * ```
 */
export class VectorStoreConnectionError extends VectorStoreError {
	constructor(
		override message: string,
		/** The type of backend that failed to connect (e.g., 'qdrant', 'pinecone') */
		public readonly backendType: string,
		/** The underlying connection error, if any */
		public override readonly cause?: Error
	) {
		super(message, 'connection', cause);
		this.name = 'VectorStoreConnectionError';
	}
}

/**
 * Vector Dimension Error
 *
 * Thrown when vector dimensions don't match the configured dimension.
 * This is a common error when the embedding model changes.
 *
 * @example
 * ```typescript
 * throw new VectorDimensionError(
 *   `Expected dimension ${expected}, got ${actual}`,
 *   expected,
 *   actual
 * );
 * ```
 */
export class VectorDimensionError extends VectorStoreError {
	constructor(
		override message: string,
		/** The expected vector dimension */
		public readonly expectedDimension: number,
		/** The actual vector dimension received */
		public readonly actualDimension: number,
		/** The underlying error, if any */
		public override readonly cause?: Error
	) {
		super(message, 'dimension_mismatch', cause);
		this.name = 'VectorDimensionError';
	}
}

/**
 * Collection Not Found Error
 *
 * Thrown when attempting to access a collection that doesn't exist.
 *
 * @example
 * ```typescript
 * throw new CollectionNotFoundError(
 *   `Collection '${collectionName}' does not exist`,
 *   collectionName
 * );
 * ```
 */
export class CollectionNotFoundError extends VectorStoreError {
	constructor(
		override message: string,
		/** The name of the collection that was not found */
		public readonly collectionName: string,
		/** The underlying error, if any */
		public override readonly cause?: Error
	) {
		super(message, 'collection_not_found', cause);
		this.name = 'CollectionNotFoundError';
	}
}

/**
 * Transformation strategy for handling complex payload fields
 */
export type PayloadTransformationStrategy =
	| 'json-string' // Serialize complex objects to JSON strings
	| 'dot-notation' // Flatten nested objects using dot notation (e.g., user.name -> user_name)
	| 'comma-separated' // Convert arrays to comma-separated strings
	| 'boolean-flags' // Convert arrays to multiple boolean fields
	| 'preserve'; // Keep as-is (for simple types)

/**
 * Configuration for field transformation
 */
export interface FieldTransformationConfig {
	/** The transformation strategy to use for this field */
	strategy: PayloadTransformationStrategy;
	/** Optional custom transformer function for complex scenarios */
	customTransformer?: {
		serialize: (value: any) => any;
		deserialize: (value: any) => any;
	};
	/** Prefix for flattened or boolean flag fields */
	prefix?: string;
}

/**
 * Payload transformation configuration
 */
export interface PayloadTransformationConfig {
	/** Default strategy for unknown fields */
	defaultStrategy: PayloadTransformationStrategy;
	/** Field-specific transformation rules */
	fieldConfigs: Record<string, FieldTransformationConfig>;
	/** Whether to handle nested objects automatically */
	autoFlattenNested: boolean;
	/** Maximum depth for auto-flattening nested objects */
	maxNestingDepth: number;
}

/**
 * Payload adapter interface for ChromaDB compatibility
 */
export interface ChromaPayloadAdapter {
	/**
	 * Transform a complex payload to ChromaDB-compatible format
	 * @param payload - The original payload with potentially nested data
	 * @returns ChromaDB-compatible flat metadata object
	 */
	serialize(payload: Record<string, any>): Record<string, string | number | boolean>;

	/**
	 * Transform ChromaDB metadata back to original payload format
	 * @param metadata - The flat metadata from ChromaDB
	 * @returns Reconstructed payload object
	 */
	deserialize(metadata: Record<string, any>): Record<string, any>;

	/**
	 * Get the transformation configuration
	 */
	getConfig(): PayloadTransformationConfig;

	/**
	 * Update the transformation configuration
	 */
	updateConfig(config: Partial<PayloadTransformationConfig>): void;
}
