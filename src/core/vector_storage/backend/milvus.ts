// Import the actual Milvus client
import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';
import type { VectorStore } from './vector-store.js';
import type { SearchFilters, VectorStoreResult, MilvusBackendConfig } from './types.js';
import { VectorStoreError, VectorStoreConnectionError, VectorDimensionError } from './types.js';
import { Logger, createLogger } from '../../logger/index.js';
import { LOG_PREFIXES, ERROR_MESSAGES } from '../constants.js';
import { env } from '../../env.js';
import { getMilvusConnectionPool, type MilvusConnectionConfig } from '../connection-pool.js';

/**
 * MilvusBackend Class
 *
 * Implements the VectorStore interface for Milvus vector database.
 *
 * Note: Only address (url/host/port) is used for MilvusClient connection.
 * If authentication is needed, extend config and update here.
 */
export class MilvusBackend implements VectorStore {
	private client: MilvusClient | null = null;
	private readonly config: MilvusBackendConfig;
	private readonly collectionName: string;
	private readonly dimension: number;
	private readonly logger: Logger;
	private connected = false;
	private readonly connectionConfig: MilvusConnectionConfig;

	// Milvus collection configuration
	private readonly MILVUS_COLLECTION_CONFIG = {
		schema: [
			{
				name: 'id',
				description: 'Primary key',
				data_type: DataType.Int64,
				is_primary_key: true,
			},
			{
				name: 'vector',
				description: 'Vector field',
				data_type: DataType.FloatVector,
			},
			{
				name: 'payload',
				description: 'Payload',
				data_type: DataType.JSON,
			},
		],
	};

	constructor(config: MilvusBackendConfig) {
		this.config = config;
		this.collectionName = config.collectionName;
		this.dimension = config.dimension;
		this.logger = createLogger({
			level: env.CIPHER_LOG_LEVEL || 'info',
		});

		// Prepare connection configuration for pool
		this.connectionConfig = {
			url: config.url || undefined,
			host: config.host || undefined,
			port: config.port || undefined,
			username: config.username || env.VECTOR_STORE_USERNAME || undefined,
			password: config.password || env.VECTOR_STORE_PASSWORD || undefined,
		} as MilvusConnectionConfig;

		this.logger.debug(`${LOG_PREFIXES.MILVUS} Backend initialized with connection pooling`, {
			collection: this.collectionName,
			dimension: this.dimension,
			connectionKey: this.generateConnectionKey(),
		});
	}

	/**
	 * Generate a connection key for logging (without sensitive data)
	 */
	private generateConnectionKey(): string {
		const address =
			this.connectionConfig.url ||
			(this.connectionConfig.host && this.connectionConfig.port
				? `${this.connectionConfig.host}:${this.connectionConfig.port}`
				: env.VECTOR_STORE_URL);
		return `${address}:${this.connectionConfig.username || 'anonymous'}`;
	}

	/**
	 * Ensure the client is available and connected
	 */
	private ensureClient(): MilvusClient {
		if (!this.client) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'operation');
		}
		return this.client;
	}

	private validateDimension(vector: number[], _operation: string): void {
		if (vector.length !== this.dimension) {
			throw new VectorDimensionError(
				`${ERROR_MESSAGES.INVALID_DIMENSION}: expected ${this.dimension}, got ${vector.length}`,
				this.dimension,
				vector.length
			);
		}
	}

	async connect(): Promise<void> {
		if (this.connected) {
			this.logger.debug(`${LOG_PREFIXES.MILVUS} Already connected`);
			return;
		}

		this.logger.debug(`${LOG_PREFIXES.MILVUS} Connecting to Milvus via connection pool`);

		try {
			// Get client from connection pool
			const connectionPool = getMilvusConnectionPool();
			this.client = await connectionPool.getClient(this.connectionConfig);

			const client = this.ensureClient();
			const collections = await client.showCollections();
			const exists = collections.data.some((c: any) => c.name === this.collectionName);

			if (!exists) {
				this.logger.debug(`${LOG_PREFIXES.MILVUS} Creating collection ${this.collectionName}`);

				// Create schema with vector field dimension
				const schema = this.MILVUS_COLLECTION_CONFIG.schema.map(field =>
					field.name === 'vector' ? { ...field, dim: this.dimension } : { ...field }
				);

				// Create collection with index parameters for Cloud Milvus compatibility
				await client.createCollection({
					collection_name: this.collectionName,
					fields: schema,
					// Include index parameters during collection creation
					index_params: [
						{
							field_name: 'vector',
							index_name: 'vector_index',
							index_type: 'AUTOINDEX',
							metric_type: 'COSINE',
						},
					],
				});

				this.logger.debug(
					`${LOG_PREFIXES.MILVUS} Collection created with indexes: ${this.collectionName}`
				);
			} else {
				this.logger.debug(
					`${LOG_PREFIXES.MILVUS} Collection already exists: ${this.collectionName}`
				);

				// For existing collections, check if indexes exist and create them if needed
				try {
					const indexes = await client.describeIndex({
						collection_name: this.collectionName,
						field_name: 'vector',
					});

					if (!indexes || !indexes.index_descriptions || indexes.index_descriptions.length === 0) {
						this.logger.debug(`${LOG_PREFIXES.MILVUS} Creating missing vector index`);
						await this.createMissingIndexes();
					}
				} catch {
					this.logger.debug(`${LOG_PREFIXES.MILVUS} Creating missing vector index`);
					await this.createMissingIndexes();
				}
			}

			// Load collection
			const clientForLoad = this.ensureClient();
			await clientForLoad.loadCollection({ collection_name: this.collectionName });
			this.connected = true;
			this.logger.debug(`${LOG_PREFIXES.MILVUS} Successfully connected`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MILVUS} Connection failed`, { error: error });
			if (error instanceof VectorStoreConnectionError) {
				throw error;
			}
			throw new VectorStoreConnectionError(
				ERROR_MESSAGES.CONNECTION_FAILED,
				'milvus',
				error as Error
			);
		}
	}

	/**
	 * Create missing indexes for existing collections
	 * This is a fallback method for collections that were created without indexes
	 */
	private async createMissingIndexes(): Promise<void> {
		try {
			// Create vector index with AUTOINDEX and COSINE metric
			const clientForIndex = this.ensureClient();
			await clientForIndex.createIndex({
				collection_name: this.collectionName,
				field_name: 'vector',
				index_name: 'vector_index',
				index_type: 'AUTOINDEX',
				metric_type: 'COSINE',
			});

			// Create payload field indexes for better filtering performance
			await this.createPayloadFieldIndexes();

			// Reload collection after index creation
			this.logger.debug(`${LOG_PREFIXES.MILVUS} Reloading collection after index creation`);
			const clientForReload = this.ensureClient();
			await clientForReload.loadCollection({ collection_name: this.collectionName });
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.MILVUS} Failed to create indexes and reload collection`);
			throw error;
		}
	}

	/**
	 * Create indexes for payload fields to improve filtering performance
	 */
	private async createPayloadFieldIndexes(): Promise<void> {
		const payloadFields = ['type', 'category', 'sessionId', 'traceId', 'timestamp'];

		for (const fieldName of payloadFields) {
			try {
				this.logger.debug(`${LOG_PREFIXES.MILVUS} Creating index for field: ${fieldName}`);
				const clientForFieldIndex = this.ensureClient();
				await clientForFieldIndex.createIndex({
					collection_name: this.collectionName,
					field_name: `payload.${fieldName}`,
					index_type: 'AUTOINDEX',
				});
			} catch (error) {
				// Continue with other fields even if one fails
				this.logger.warn(
					`${LOG_PREFIXES.MILVUS} Failed to create index for field ${fieldName}:`,
					error
				);
			}
		}
	}

	async insert(vectors: number[][], ids: number[], payloads: Record<string, any>[]): Promise<void> {
		if (!this.connected)
			return Promise.reject(new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'insert'));
		if (vectors.length !== ids.length || vectors.length !== payloads.length) {
			return Promise.reject(
				new VectorStoreError('Vectors, IDs, and payloads must have the same length', 'insert')
			);
		}
		for (const vector of vectors) this.validateDimension(vector, 'insert');
		const data = vectors.map((vector, idx) => ({
			id: ids[idx]!,
			vector,
			payload: payloads[idx],
		}));
		try {
			const clientForInsert = this.ensureClient();
			await clientForInsert.insert({
				collection_name: this.collectionName,
				data,
			});
			this.logger.debug(`Inserted ${vectors.length} vectors`);
		} catch (error) {
			this.logger.error(`Insert failed`, { error: error });
			throw new VectorStoreError('Failed to insert vectors', 'insert', error as Error);
		}
	}

	async search(
		query: number[],
		limit: number = 10,
		filters?: SearchFilters
	): Promise<VectorStoreResult[]> {
		if (!this.connected) throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'search');
		this.validateDimension(query, 'search');
		try {
			const expr = filtersToExpr(filters);
			const searchParams: any = {
				collection_name: this.collectionName,
				data: [query],
				anns_field: 'vector',
				params: { nprobe: 10 },
				limit,
				output_fields: ['id', 'payload'],
				...(expr ? { filter: expr } : {}),
			};
			const clientForSearch = this.ensureClient();
			const res = await clientForSearch.search(searchParams);
			return res.results.map((hit: any) => ({
				id: hit.id,
				score: hit.score,
				payload: hit.payload,
			}));
		} catch (error) {
			this.logger.error(`Search failed`, { error: error });
			throw new VectorStoreError(ERROR_MESSAGES.SEARCH_FAILED, 'search', error as Error);
		}
	}

	async get(vectorId: number): Promise<VectorStoreResult | null> {
		if (!this.connected)
			return Promise.reject(new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'get'));
		try {
			const clientForQuery = this.ensureClient();
			const res = await clientForQuery.query({
				collection_name: this.collectionName,
				output_fields: ['id', 'vector', 'payload'],
				filter: `id == ${vectorId}`,
			});
			if (!res.data.length || !res.data[0]) return null;
			const doc = res.data[0];
			if (!doc) return null;
			return {
				id: vectorId,
				vector: doc.vector,
				payload: doc.payload,
				score: 1.0,
			};
		} catch (error) {
			this.logger.error(`Get failed`, { error: error });
			throw new VectorStoreError('Failed to retrieve vector', 'get', error as Error);
		}
	}

	async update(vectorId: number, vector: number[], payload: Record<string, any>): Promise<void> {
		if (!this.connected)
			return Promise.reject(new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'update'));
		this.validateDimension(vector, 'update');
		try {
			const clientForUpsert = this.ensureClient();
			await clientForUpsert.upsert({
				collection_name: this.collectionName,
				data: [{ id: vectorId, vector, payload }],
			});
			this.logger.debug(`${LOG_PREFIXES.MILVUS} Updated vector ${vectorId}`);
		} catch (error) {
			this.logger.error(`Update failed`, { error: error });
			throw new VectorStoreError('Failed to update vector', 'update', error as Error);
		}
	}

	async delete(vectorId: number): Promise<void> {
		if (!this.connected)
			return Promise.reject(new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'delete'));
		try {
			const clientForDelete = this.ensureClient();
			await clientForDelete.deleteEntities({
				collection_name: this.collectionName,
				expr: `id == ${vectorId}`,
			});
			this.logger.debug(`${LOG_PREFIXES.MILVUS} Deleted vector ${vectorId}`);
		} catch (error) {
			this.logger.error(`Delete failed`, { error: error });
			throw new VectorStoreError('Failed to delete vector', 'delete', error as Error);
		}
	}

	async deleteCollection(): Promise<void> {
		if (!this.connected)
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'deleteCollection');
		try {
			const clientForDrop = this.ensureClient();
			await clientForDrop.dropCollection({ collection_name: this.collectionName });
			this.logger.info(`Deleted collection ${this.collectionName}`);
		} catch (error) {
			this.logger.error(`Delete collection failed`, { error: error });
			throw new VectorStoreError('Failed to delete collection', 'deleteCollection', error as Error);
		}
	}

	async list(
		filters?: SearchFilters,
		limit: number = 10000
	): Promise<[VectorStoreResult[], number]> {
		if (!this.connected) throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'list');
		try {
			const expr = filtersToExpr(filters);
			const queryParams: any = {
				collection_name: this.collectionName,
				output_fields: ['id', 'vector', 'payload'],
				limit,
				...(expr ? { filter: expr } : {}),
			};
			const clientForList = this.ensureClient();
			const res = await clientForList.query(queryParams);
			const results = (res.data || [])
				.map(
					(doc: any) =>
						doc && {
							id: doc.id,
							vector: doc.vector,
							payload: doc.payload,
							score: 1.0,
						}
				)
				.filter(Boolean);
			return [results, results.length];
		} catch (error) {
			this.logger.error(`List failed`, { error: error });
			throw new VectorStoreError('Failed to list vectors', 'list', error as Error);
		}
	}

	async disconnect(): Promise<void> {
		if (this.client) {
			// Release client back to connection pool
			const connectionPool = getMilvusConnectionPool();
			connectionPool.releaseClient(this.connectionConfig);
			this.client = null;
		}
		this.connected = false;
		this.logger.info(`${LOG_PREFIXES.MILVUS} Disconnected and released connection to pool`);
	}

	isConnected(): boolean {
		return this.connected;
	}

	getBackendType(): string {
		return 'milvus';
	}

	getDimension(): number {
		return this.dimension;
	}

	getCollectionName(): string {
		return this.collectionName;
	}

	async listCollections(): Promise<string[]> {
		if (!this.connected)
			return Promise.reject(new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'listCollections'));
		const clientForListCollections = this.ensureClient();
		const collections = await clientForListCollections.showCollections();
		return collections.data.map((c: any) => c.name);
	}
}

function filtersToExpr(filters?: SearchFilters): string | undefined {
	if (!filters) return undefined;
	// Support equality, 'in', and comparison operators (gte, lte, gt, lt)
	return Object.entries(filters)
		.map(([key, value]) => {
			if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
				return `${key} == "${value}"`;
			}
			if (value && typeof value === 'object') {
				// Support 'in' operator
				if ('any' in value && Array.isArray(value.any)) {
					const arr = value.any.map(v => `"${v}"`).join(', ');
					return `${key} in [${arr}]`;
				}
				// Support comparison operators
				const ops: Record<string, string> = { gte: '>=', lte: '<=', gt: '>', lt: '<' };
				return Object.entries(ops)
					.filter(([op]) => op in (value as Record<string, unknown>))
					.map(([op, symbol]) => `${key} ${symbol} ${(value as Record<string, unknown>)[op]}`)
					.join(' && ');
			}
			return '';
		})
		.filter(Boolean)
		.join(' && ');
}
