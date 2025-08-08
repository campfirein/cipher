/**
 * Vector Storage Configuration Module
 *
 * Defines the configuration schemas for the vector storage system using Zod for
 * runtime validation and type safety. Supports multiple backend types with
 * different configuration requirements.
 *
 * The vector storage system provides similarity search capabilities:
 * - Vector Backend: For similarity search over embeddings
 *
 * Supported backends:
 * - In-Memory: Fast local storage for development/testing
 * - Qdrant: High-performance vector similarity search engine
 * - Milvus: Open-source vector database with horizontal scaling
 * - ChromaDB: Developer-friendly open-source embedding database
 * - Pinecone: Managed vector database service (planned)
 * - Weaviate: Open-source vector search engine (planned)
 *
 * @module vector_storage/config
 */

import { z } from 'zod';
import { DEFAULTS, DISTANCE_METRICS } from './constants.js';

/**
 * Base Vector Store Configuration Schema
 *
 * Common configuration options shared by all vector store types.
 * These options control collection settings and connection behavior.
 */
const BaseVectorStoreSchema = z.object({
	/** Name of the collection/index to use */
	collectionName: z.string().min(1).describe('Collection name'),

	/** Dimension of vectors (must match embedding model output) */
	dimension: z.number().int().positive().default(DEFAULTS.DIMENSION).describe('Vector dimension'),

	/** Maximum number of concurrent connections */
	maxConnections: z.number().int().positive().optional().describe('Maximum connections'),

	/** Connection timeout in milliseconds */
	connectionTimeoutMillis: z.number().int().positive().optional().describe('Connection timeout'),

	/** Backend-specific options */
	options: z.record(z.any()).optional().describe('Backend-specific options'),
});

/**
 * In-Memory Vector Store Configuration
 *
 * Simple in-memory vector storage for development and testing.
 * Data is lost when the process exits.
 *
 * @example
 * ```typescript
 * const config: InMemoryBackendConfig = {
 *   type: 'in-memory',
 *   collectionName: 'test_vectors',
 *   dimension: 1536,
 *   maxVectors: 10000
 * };
 * ```
 */
const InMemoryBackendSchema = BaseVectorStoreSchema.extend({
	type: z.literal('in-memory'),

	/** Maximum number of vectors to store (prevents memory overflow) */
	maxVectors: z.number().int().positive().default(10000).describe('Maximum vectors to store'),
}).strict();

export type InMemoryBackendConfig = z.infer<typeof InMemoryBackendSchema>;

/**
 * Qdrant Backend Configuration
 *
 * Configuration for Qdrant vector database backend.
 * Supports both direct connection parameters and connection URLs.
 *
 * @example
 * ```typescript
 * // Using connection URL
 * const config: QdrantBackendConfig = {
 *   type: 'qdrant',
 *   url: 'http://localhost:6333',
 *   collectionName: 'documents',
 *   dimension: 1536
 * };
 *
 * // Using individual parameters
 * const config: QdrantBackendConfig = {
 *   type: 'qdrant',
 *   host: 'localhost',
 *   port: 6333,
 *   apiKey: 'secret',
 *   collectionName: 'documents',
 *   dimension: 1536
 * };
 * ```
 */
const QdrantBackendSchema = BaseVectorStoreSchema.extend({
	type: z.literal('qdrant'),

	/** Qdrant connection URL (http://...) - overrides individual params if provided */
	url: z.string().url().optional().describe('Qdrant connection URL'),

	/** Qdrant server hostname */
	host: z.string().optional().describe('Qdrant host'),

	/** Qdrant REST API port (default: 6333) */
	port: z
		.number()
		.int()
		.positive()
		.default(DEFAULTS.QDRANT_PORT)
		.optional()
		.describe('Qdrant port'),

	/** Qdrant API key for authentication */
	apiKey: z.string().optional().describe('Qdrant API key'),

	/** Store vectors on disk (for large datasets) */
	onDisk: z.boolean().optional().describe('Store vectors on disk'),

	/** Path for local Qdrant storage (if not using remote server) */
	path: z.string().optional().describe('Local storage path'),

	/** Distance metric for similarity search */
	distance: z
		.enum([
			DISTANCE_METRICS.COSINE,
			DISTANCE_METRICS.EUCLIDEAN,
			DISTANCE_METRICS.DOT_PRODUCT,
			DISTANCE_METRICS.MANHATTAN,
		] as const)
		.default(DEFAULTS.QDRANT_DISTANCE)
		.optional()
		.describe('Distance metric'),
}).strict();

export type QdrantBackendConfig = z.infer<typeof QdrantBackendSchema>;

/**
 * Milvus Backend Configuration
 *
 * Configuration for Milvus vector database backend.
 *
 * @example
 * ```typescript
 * const config: MilvusBackendConfig = {
 *   type: 'milvus',
 *   url: 'http://localhost:19530',
 *   collectionName: 'documents',
 *   dimension: 1536
 * };
 * ```
 */
const MilvusBackendSchema = BaseVectorStoreSchema.extend({
	type: z.literal('milvus'),

	/** Milvus connection URL (http://...) - overrides individual params if provided */
	url: z.string().url().optional().describe('Milvus connection URL'),

	/** Milvus server hostname */
	host: z.string().optional().describe('Milvus host'),

	/** Milvus REST API port (default: 19530) */
	port: z.number().int().positive().default(19530).optional().describe('Milvus port'),

	/** Milvus username for authentication (Zilliz Cloud) */
	username: z.string().optional().describe('Milvus username'),

	/** Milvus password for authentication (Zilliz Cloud) */
	password: z.string().optional().describe('Milvus password'),

	/** Milvus API token for authentication (Zilliz Cloud) */
	token: z.string().optional().describe('Milvus API token'),
}).strict();

export type MilvusBackendConfig = z.infer<typeof MilvusBackendSchema>;

const PgVectorBackendSchema = BaseVectorStoreSchema.extend({
	type: z.literal('pgvector'),

	/** PgVector connection URL (http://...) - overrides individual params if provided */
	url: z.string().url().describe('PgVector connection URL'),

	/** PgVector connection pool size */
	poolSize: z
		.number()
		.int()
		.positive()
		.default(5)
		.optional()
		.describe('PgVector connection pool size'),

	/** PgVector index type */
	indexType: z
		.enum(['ivfflat', 'hnsw'])
		.default('ivfflat')
		.optional()
		.describe('PgVector index type'),

	/** PgVector index metric */
	indexMetric: z
		.enum(['vector_l2_ops', 'vector_ip_ops'])
		.default('vector_l2_ops')
		.optional()
		.describe('PgVector index metric'),

	/** Distance metric for similarity search */
	distance: z
		.enum([
			DISTANCE_METRICS.COSINE,
			DISTANCE_METRICS.EUCLIDEAN,
			DISTANCE_METRICS.DOT_PRODUCT,
			DISTANCE_METRICS.MANHATTAN,
		] as const)
		.default(DEFAULTS.PGVECTOR_DISTANCE)
		.optional()
		.describe('Distance metric'),
}).strict();

export type PgVectorBackendConfig = z.infer<typeof PgVectorBackendSchema>;

/**
 * ChromaDB Backend Configuration
 *
 * Configuration for ChromaDB vector database backend.
 * Supports both HTTP client connection and embedded mode.
 *
 * @example
 * ```typescript
 * // Using connection URL
 * const config: ChromaBackendConfig = {
 *   type: 'chroma',
 *   url: 'http://localhost:8000',
 *   collectionName: 'documents',
 *   dimension: 1536
 * };
 *
 * // Using individual parameters
 * const config: ChromaBackendConfig = {
 *   type: 'chroma',
 *   host: 'localhost',
 *   port: 8000,
 *   collectionName: 'documents',
 *   dimension: 1536,
 *   headers: { 'Authorization': 'Bearer token' }
 * };
 * ```
 */
const ChromaBackendSchema = BaseVectorStoreSchema.extend({
	type: z.literal('chroma'),

	/** ChromaDB connection URL (http://...) - overrides individual params if provided */
	url: z.string().url().optional().describe('ChromaDB connection URL'),

	/** ChromaDB server hostname */
	host: z.string().optional().describe('ChromaDB host'),

	/** ChromaDB HTTP port (default: 8000) */
	port: z.number().int().positive().default(8000).optional().describe('ChromaDB port'),

	/** Use SSL/TLS for connection (default: false) */
	ssl: z.boolean().default(false).optional().describe('Use SSL/TLS for connection'),

	/** Custom HTTP headers for authentication */
	headers: z.record(z.string()).optional().describe('Custom HTTP headers'),

	/** Distance metric for similarity search */
	distance: z
		.enum(['cosine', 'l2', 'euclidean', 'ip', 'dot'] as const)
		.default('cosine')
		.optional()
		.describe('Distance metric'),

	/** Custom path for ChromaDB API endpoints */
	path: z.string().optional().describe('Custom API path'),
}).strict();

export type ChromaBackendConfig = z.infer<typeof ChromaBackendSchema>;

/**
 * Backend Configuration Union Schema
 *
 * Discriminated union of all supported backend configurations.
 * Uses the 'type' field to determine which configuration schema to apply.
 *
 * Includes custom validation to ensure backends have required connection info.
 */
const BackendConfigSchema = z
	.discriminatedUnion(
		'type',
		[
			InMemoryBackendSchema,
			QdrantBackendSchema,
			MilvusBackendSchema,
			ChromaBackendSchema,
			PgVectorBackendSchema,
		],
		{
			errorMap: (issue, ctx) => {
				if (issue.code === z.ZodIssueCode.invalid_union_discriminator) {
					return {
						message: `Invalid backend type. Expected 'in-memory', 'qdrant', 'milvus', 'pgvector' or 'chroma'.`,
					};
				}
				return { message: ctx.defaultError };
			},
		}
	)
	.describe('Backend configuration for vector storage system')
	.superRefine((data, ctx) => {
		// Validate Qdrant backend requirements
		if (data.type === 'qdrant') {
			// Qdrant requires either a connection URL or a host
			if (!data.url && !data.host) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Qdrant backend requires either 'url' or 'host' to be specified",
					path: ['url'],
				});
			}
		}
		// Validate Milvus backend requirements
		if (data.type === 'milvus') {
			if (!data.url && !data.host) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Milvus backend requires either 'url' or 'host' to be specified",
					path: ['url'],
				});
			}
		}
		// Validate ChromaDB backend requirements
		if (data.type === 'chroma') {
			// ChromaDB requires either a connection URL or a host
			if (!data.url && !data.host) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "ChromaDB backend requires either 'url' or 'host' to be specified",
					path: ['url'],
				});
			}
		}
		// Validate collection name format
		if (!/^[a-zA-Z0-9_-]+$/.test(data.collectionName)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Collection name must contain only letters, numbers, underscores, and hyphens',
				path: ['collectionName'],
			});
		}
	});

export type BackendConfig = z.infer<typeof BackendConfigSchema>;

/**
 * Vector Storage System Configuration Schema
 *
 * Top-level configuration for the vector storage system.
 * Unlike the dual-backend storage system, vector storage uses a single backend.
 *
 * @example
 * ```typescript
 * const vectorConfig: VectorStoreConfig = {
 *   type: 'qdrant',
 *   host: 'localhost',
 *   port: 6333,
 *   collectionName: 'embeddings',
 *   dimension: 1536
 * };
 * ```
 */
export const VectorStoreSchema = BackendConfigSchema;

export type VectorStoreConfig = z.infer<typeof VectorStoreSchema>;
