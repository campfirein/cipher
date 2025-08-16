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
 * - Pinecone: Managed vector database service
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
 * Pinecone Backend Configuration
 *
 * Configuration for Pinecone managed vector database backend.
 * Requires API key and environment for authentication.
 *
 * @example
 * ```typescript
 * const config: PineconeBackendConfig = {
 *   type: 'pinecone',
 *   apiKey: 'your-api-key',
 *   indexName: 'knowledge-memory',
 *   dimension: 1536,
 *   namespace: 'default'
 * };
 * ```
 */
const PineconeBackendSchema = BaseVectorStoreSchema.extend({
	type: z.literal('pinecone'),

	/** Pinecone API key for authentication */
	apiKey: z.string().min(1).describe('Pinecone API key'),

	/** Pinecone namespace for multi-tenancy (optional) */
	namespace: z.string().optional().describe('Pinecone namespace'),

	/** Pinecone provider (optional) */
	provider: z.string().optional().describe('Pinecone provider'),

	/** Pinecone region (default: 'us-west1') */
	region: z.string().default(DEFAULTS.PINECONE_REGION).optional().describe('Pinecone region'),

	/** Distance metric for similarity search */
	metric: z
		.enum(['cosine', 'euclidean', 'dotproduct'] as const)
		.default('cosine')
		.optional()
		.describe('Distance metric'),

	/** Pinecone pod type (for performance tuning) */
	podType: z.string().optional().describe('Pinecone pod type'),

	/** Number of replicas for high availability */
	replicas: z.number().int().positive().optional().describe('Number of replicas'),

	/** Source collection for cloning */
	sourceCollection: z.string().optional().describe('Source collection for cloning'),
}).strict();

export type PineconeBackendConfig = z.infer<typeof PineconeBackendSchema>;

/**
 * PgVector Backend Configuration
 *
 * Configuration for PostgreSQL with pgvector extension.
 * Supports both connection URL and individual parameters.
 *
 * @example
 * ```typescript
 * // Using connection URL
 * const config: PgVectorBackendConfig = {
 *   type: 'pgvector',
 *   url: 'postgresql://user:pass@localhost:5432/vectordb',
 *   collectionName: 'embeddings',
 *   dimension: 1536
 * };
 *
 * // Using individual parameters
 * const config: PgVectorBackendConfig = {
 *   type: 'pgvector',
 *   host: 'localhost',
 *   port: 5432,
 *   database: 'vectordb',
 *   username: 'user',
 *   password: 'password',
 *   collectionName: 'embeddings',
 *   dimension: 1536,
 *   ssl: true
 * };
 * ```
 */

const PgVectorBackendSchema = BaseVectorStoreSchema.extend({
	type: z.literal('pgvector'),

	/** PostgreSQL connection URL (postgresql://...) - overrides individual params if provided */
	url: z.string().url().optional().describe('PostgreSQL connection URL'),

	/** PostgreSQL server hostname */
	host: z.string().optional().describe('PostgreSQL host'),

	/** PostgreSQL server port (default: 5432) */
	port: z.number().int().positive().default(5432).optional().describe('PostgreSQL port'),

	/** Database name */
	database: z.string().optional().describe('Database name'),

	/** Username for authentication */
	username: z.string().optional().describe('PostgreSQL username'),

	/** Password for authentication */
	password: z.string().optional().describe('PostgreSQL password'),

	/** Use SSL/TLS for connection (default: false) */
	ssl: z.boolean().default(false).optional().describe('Use SSL/TLS for connection'),

	/** Distance metric for similarity search */
	distance: z
		.enum(['cosine', 'l2', 'inner_product'] as const)
		.default('cosine')
		.optional()
		.describe('Distance metric for pgvector'),

	/** Connection pool size (default: 10) */
	poolSize: z.number().int().positive().default(10).optional().describe('Connection pool size'),

	/** Index type for vector similarity search */
	indexType: z
		.enum(['ivfflat', 'hnsw'] as const)
		.default('hnsw')
		.optional()
		.describe('Vector index type'),

	indexMetric: z
		.enum(['vector_l2_ops', 'vector_ip_ops', 'vector_cosine_ops'] as const)
		.default('vector_l2_ops')
		.optional()
		.describe('Vector index metric for pgvector'),
	/** Schema name (default: 'public') */
	schema: z.string().default('public').optional().describe('PostgreSQL schema name'),
}).strict();

export type PgVectorBackendConfig = z.infer<typeof PgVectorBackendSchema>;
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
			PineconeBackendSchema,
			PgVectorBackendSchema,
		],
		{
			errorMap: (issue, ctx) => {
				if (issue.code === z.ZodIssueCode.invalid_union_discriminator) {
					return {
						message: `Invalid backend type. Expected 'in-memory', 'qdrant', 'milvus', 'chroma', or 'pinecone'.`,
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
		// Validate Pinecone backend requirements
		if (data.type === 'pinecone') {
			// Pinecone requires API key, environment, and indexName
			if (!data.apiKey) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Pinecone backend requires 'apiKey' to be specified",
					path: ['apiKey'],
				});
			}
		}
		// Validate PgVector backend requirements
		if (data.type === 'pgvector') {
			// PgVector requires either a connection URL or host and database
			if (!data.url && (!data.host || !data.database)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message:
						"PgVector backend requires either 'url' or both 'host' and 'database' to be specified",
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
