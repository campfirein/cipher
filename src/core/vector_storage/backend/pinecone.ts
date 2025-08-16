/**
 * Pinecone Vector Store Backend
 *
 * Implementation of the VectorStore interface for Pinecone vector database.
 * Pinecone is a managed vector database service for high-performance similarity search.
 *
 * Features:
 * - Managed, scalable vector search
 * - Metadata filtering
 * - Namespace support for multi-tenancy
 * - REST API with high availability
 *
 * @module vector_storage/backend/pinecone
 */

import { Pinecone } from '@pinecone-database/pinecone';
import type { VectorStore } from './vector-store.js';
import type { SearchFilters, VectorStoreResult, PineconeBackendConfig } from './types.js';
import { VectorStoreError, VectorStoreConnectionError, VectorDimensionError } from './types.js';
import { Logger, createLogger } from '../../logger/index.js';
import { LOG_PREFIXES, DEFAULTS, ERROR_MESSAGES } from '../constants.js';

/**
 * Pinecone filter structure
 */
interface PineconeFilter {
	[key: string]: any;
}

/**
 * PineconeBackend Class
 *
 * Implements the VectorStore interface for Pinecone vector database.
 */
export class PineconeBackend implements VectorStore {
	private client: Pinecone;
	private index: any = null;
	private readonly config: PineconeBackendConfig;
	private readonly indexName: string;
	private readonly dimension: number;
	private readonly namespace: string;
	private readonly provider: string;
	private readonly region: string;
	private readonly logger: Logger;
	private connected = false;

	constructor(config: PineconeBackendConfig) {
		this.config = config;
		this.indexName = config.collectionName;
		this.dimension = config.dimension;
		this.namespace = config.namespace || DEFAULTS.PINECONE_NAMESPACE;
		this.provider = config.provider || DEFAULTS.PINECONE_PROVIDER;
		this.region = config.region || DEFAULTS.PINECONE_REGION;

		this.logger = createLogger({
			level: process.env.CIPHER_LOG_LEVEL || 'info',
		});
		this.client = new Pinecone({
			apiKey: this.config.apiKey,
		});

		this.logger.debug(`${LOG_PREFIXES.PINECONE} Initialized`, {
			indexName: this.indexName,
			dimension: this.dimension,
			namespace: this.namespace,
		});
	}

	/**
	 * Convert search filters to Pinecone filter format
	 */
	private createFilter(filters?: SearchFilters): PineconeFilter | undefined {
		if (!filters) return undefined;

		const pineconeFilter: PineconeFilter = {};

		for (const [key, value] of Object.entries(filters)) {
			if (value === null || value === undefined) continue;

			// Handle range queries
			if (
				typeof value === 'object' &&
				!Array.isArray(value) &&
				('gte' in value || 'gt' in value || 'lte' in value || 'lt' in value)
			) {
				const rangeConditions: any = {};
				if ('gte' in value && value.gte !== undefined) rangeConditions.$gte = value.gte;
				if ('gt' in value && value.gt !== undefined) rangeConditions.$gt = value.gt;
				if ('lte' in value && value.lte !== undefined) rangeConditions.$lte = value.lte;
				if ('lt' in value && value.lt !== undefined) rangeConditions.$lt = value.lt;
				pineconeFilter[key] = rangeConditions;
			}
			// Handle array filters (any/all)
			else if (
				typeof value === 'object' &&
				!Array.isArray(value) &&
				('any' in value || 'all' in value)
			) {
				// Pinecone uses $in for "any" operations
				if ('any' in value && Array.isArray(value.any)) {
					pineconeFilter[key] = { $in: value.any };
				}
				// For 'all', we'd need multiple conditions - simplified to first value
				else if ('all' in value && Array.isArray(value.all) && value.all.length > 0) {
					pineconeFilter[key] = value.all[0];
				}
			}
			// Handle exact matches
			else {
				pineconeFilter[key] = { $eq: value };
			}
		}

		return Object.keys(pineconeFilter).length > 0 ? pineconeFilter : undefined;
	}

	/**
	 * Validate vector dimension
	 */
	private validateDimension(vector: number[], operation: string): void {
		if (vector.length !== this.dimension) {
			throw new VectorDimensionError(
				`${ERROR_MESSAGES.INVALID_DIMENSION}: expected ${this.dimension}, got ${vector.length}`,
				this.dimension,
				vector.length
			);
		}
	}

	/**
	 * Validate ID (Pinecone supports string IDs)
	 */
	private validateId(id: number): void {
		if (id === undefined || id === null || !Number.isInteger(id)) {
			throw new VectorStoreError('Pinecone point IDs must be valid integers', 'id');
		}
	}

	/**
	 * Map provider string to valid Pinecone cloud values
	 */
	private getCloudprovider(provider: string): 'aws' | 'gcp' | 'azure' {
		switch (provider.toLowerCase()) {
			case 'aws':
			case 'amazon':
				return 'aws';
			case 'gcp':
			case 'google':
			case 'gcloud':
				return 'gcp';
			case 'azure':
			case 'microsoft':
				return 'azure';
			default:
				// Default to AWS if provider not recognized
				this.logger.warn(
					`${LOG_PREFIXES.PINECONE} Unknown provider '${provider}', defaulting to 'aws'`
				);
				return 'aws';
		}
	}
	/**
	 * Create index in Pinecone
	 */
	private async createIndex(): Promise<void> {
		try {
			this.logger.info(`${LOG_PREFIXES.PINECONE} Creating index '${this.indexName}'`, {
				dimension: this.dimension,
				metric: this.config.metric || 'cosine',
			});
			const Cloudprovider = this.getCloudprovider(this.provider);
			const result = await this.client.createIndex({
				name: this.indexName,
				dimension: this.dimension,
				metric: (this.config.metric || 'cosine') as 'cosine' | 'euclidean' | 'dotproduct',
				spec: {
					serverless: {
						cloud: Cloudprovider,
						region: this.region,
					},
				},
			});
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.PINECONE} Failed to create index - DETAILED ERROR`, {
				error: error instanceof Error ? error.message : String(error),
				indexName: this.indexName,
				errorType: error?.constructor?.name,
				errorCode: (error as any)?.code,
				errorStatus: (error as any)?.status,
				errorResponse: (error as any)?.response?.data,
				fullError: JSON.stringify(error, null, 2),
			});
			throw error;
		}
	}

	async connect(): Promise<void> {
		if (this.connected) {
			this.logger.debug(`${LOG_PREFIXES.PINECONE} Already connected`);
			return;
		}

		this.logger.info(`${LOG_PREFIXES.PINECONE} Connecting to Pinecone`);

		try {
			const indexList = await this.client.listIndexes();
			const indexExists = indexList.indexes?.some(index => index.name === this.indexName);

			if (!indexExists) {
				this.logger.info(
					`${LOG_PREFIXES.PINECONE} Index '${this.indexName}' does not exist, creating...`
				);
				await this.createIndex();
			}

			// Get index reference
			this.index = this.client.index(this.indexName);

			this.connected = true;
			this.logger.info(`${LOG_PREFIXES.PINECONE} Successfully connected`, {
				indexName: this.indexName,
				namespace: this.namespace,
				dimension: this.dimension,
			});
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.PINECONE} Connection failed`, {
				error: error instanceof Error ? error.message : String(error),
				indexName: this.indexName,
			});

			// Enhanced error handling
			if (error instanceof Error) {
				// 404 errors (index not found)
				if (
					error.message.includes('404') ||
					error.message.includes('not found') ||
					error.message.includes('does not exist')
				) {
					throw new VectorStoreConnectionError(
						`Pinecone index '${this.indexName}' not found (HTTP 404). Please create the index in your Pinecone dashboard first or set PINECONE_AUTO_CREATE_INDEX=true.`,
						'pinecone',
						error
					);
				}

				// Authentication errors
				if (
					error.message.includes('401') ||
					error.message.includes('403') ||
					error.message.includes('Unauthorized') ||
					error.message.includes('Forbidden')
				) {
					throw new VectorStoreConnectionError(
						`Pinecone authentication failed. Please check your API key.`,
						'pinecone',
						error
					);
				}

				// Rate limiting
				if (error.message.includes('429') || error.message.includes('rate limit')) {
					throw new VectorStoreConnectionError(
						`Pinecone rate limit exceeded. Please try again later.`,
						'pinecone',
						error
					);
				}
			}

			if (error instanceof VectorStoreConnectionError) {
				throw error;
			}

			throw new VectorStoreConnectionError(
				ERROR_MESSAGES.CONNECTION_FAILED,
				'pinecone',
				error as Error
			);
		}
	}

	async disconnect(): Promise<void> {
		if (!this.connected) {
			this.logger.debug(`${LOG_PREFIXES.PINECONE} Already disconnected`);
			return;
		}

		this.logger.info(`${LOG_PREFIXES.PINECONE} Disconnecting from Pinecone`);

		// Pinecone client doesn't have explicit disconnect
		// Just mark as disconnected and clear index reference
		this.index = null;
		this.connected = false;

		this.logger.info(`${LOG_PREFIXES.PINECONE} Successfully disconnected`);
	}

	async insert(vectors: number[][], ids: number[], payloads: Record<string, any>[]): Promise<void> {
		if (!this.connected || !this.index) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'insert');
		}

		// Validate inputs
		if (vectors.length !== ids.length || vectors.length !== payloads.length) {
			throw new VectorStoreError('Vectors, IDs, and payloads must have the same length', 'insert');
		}

		if (vectors.length === 0) {
			this.logger.debug(`${LOG_PREFIXES.PINECONE} No vectors to insert`);
			return;
		}

		// Validate dimensions and IDs
		for (let i = 0; i < vectors.length; i++) {
			const vector = vectors[i];
			const id = ids[i];

			if (!vector) {
				throw new Error(`Vector at index ${i} is missing`);
			}
			if (id == null) {
				throw new Error(`ID at index ${i} is missing`);
			}

			this.validateDimension(vector, 'insert');
			this.validateId(id);
		}

		this.logger.debug(`${LOG_PREFIXES.PINECONE} Inserting ${vectors.length} vectors`);

		try {
			const upsertData = vectors.map((vector, idx) => {
				const id = ids[idx];
				if (id == null) {
					throw new Error(`ID at index ${idx} is missing`);
				}
				return {
					id: id.toString(),
					values: vector,
					metadata: payloads[idx] || {},
				};
			});

			const upsertRequest: any = {
				vectors: upsertData,
			};

			if (this.namespace !== DEFAULTS.PINECONE_NAMESPACE) {
				upsertRequest.namespace = this.namespace;
			}

			await this.index.upsert(upsertRequest);

			this.logger.debug(`${LOG_PREFIXES.PINECONE} Successfully inserted ${vectors.length} vectors`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.PINECONE} Insert failed`, {
				error: error instanceof Error ? error.message : String(error),
				vectorCount: vectors.length,
			});
			throw new VectorStoreError('Failed to insert vectors', 'insert', error as Error);
		}
	}

	async search(
		query: number[],
		limit: number = DEFAULTS.SEARCH_LIMIT,
		filters?: SearchFilters
	): Promise<VectorStoreResult[]> {
		if (!this.connected || !this.index) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'search');
		}

		this.validateDimension(query, 'search');

		if (limit <= 0) {
			throw new VectorStoreError('Search limit must be positive', 'search');
		}

		this.logger.debug(`${LOG_PREFIXES.PINECONE} Searching with limit ${limit}`, {
			hasFilters: !!filters,
		});

		try {
			const pineconeFilter = this.createFilter(filters);

			const queryRequest: any = {
				vector: query,
				topK: Math.min(limit, 10000), // Pinecone limit
				includeMetadata: true,
				includeValues: false, // Usually not needed for search results
			};

			if (this.namespace !== DEFAULTS.PINECONE_NAMESPACE) {
				queryRequest.namespace = this.namespace;
			}

			if (pineconeFilter) {
				queryRequest.filter = pineconeFilter;
			}

			const searchResponse = await this.index.query(queryRequest);

			const results: VectorStoreResult[] = [];
			if (searchResponse.matches) {
				for (const match of searchResponse.matches) {
					results.push({
						id: parseInt(match.id, 10),
						score: match.score || 0,
						payload: match.metadata || {},
						vector: match.values || [],
					});
				}
			}

			this.logger.debug(`${LOG_PREFIXES.PINECONE} Found ${results.length} results`);
			return results;
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.PINECONE} Search failed`, {
				error: error instanceof Error ? error.message : String(error),
				limit,
			});
			throw new VectorStoreError(ERROR_MESSAGES.SEARCH_FAILED, 'search', error as Error);
		}
	}

	async get(vectorId: number): Promise<VectorStoreResult | null> {
		if (!this.connected || !this.index) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'get');
		}

		this.validateId(vectorId);
		this.logger.debug(`${LOG_PREFIXES.PINECONE} Getting vector ${vectorId}`);

		try {
			const fetchRequest: any = {
				ids: [vectorId.toString()],
			};

			if (this.namespace !== DEFAULTS.PINECONE_NAMESPACE) {
				fetchRequest.namespace = this.namespace;
			}

			const response = await this.index.fetch(fetchRequest);

			if (!response.vectors || !response.vectors[vectorId.toString()]) {
				return null;
			}

			const vector = response.vectors[vectorId.toString()];

			return {
				id: vectorId,
				vector: vector.values || [],
				payload: vector.metadata || {},
				score: 1.0,
			};
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.PINECONE} Get failed`, {
				error: error instanceof Error ? error.message : String(error),
				vectorId,
			});
			throw new VectorStoreError('Failed to retrieve vector', 'get', error as Error);
		}
	}

	async update(vectorId: number, vector: number[], payload: Record<string, any>): Promise<void> {
		if (!this.connected || !this.index) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'update');
		}

		this.validateDimension(vector, 'update');
		this.validateId(vectorId);
		this.logger.debug(`${LOG_PREFIXES.PINECONE} Updating vector ${vectorId}`);

		try {
			const upsertRequest: any = {
				vectors: [
					{
						id: vectorId.toString(),
						values: vector,
						metadata: payload || {},
					},
				],
			};

			if (this.namespace !== DEFAULTS.PINECONE_NAMESPACE) {
				upsertRequest.namespace = this.namespace;
			}

			await this.index.upsert(upsertRequest);

			this.logger.debug(`${LOG_PREFIXES.PINECONE} Successfully updated vector ${vectorId}`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.PINECONE} Update failed`, {
				error: error instanceof Error ? error.message : String(error),
				vectorId,
			});
			throw new VectorStoreError('Failed to update vector', 'update', error as Error);
		}
	}

	async delete(vectorId: number): Promise<void> {
		if (!this.connected || !this.index) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'delete');
		}

		this.validateId(vectorId);
		this.logger.debug(`${LOG_PREFIXES.PINECONE} Deleting vector ${vectorId}`);

		try {
			const deleteRequest: any = {
				ids: [vectorId.toString()],
			};

			if (this.namespace !== DEFAULTS.PINECONE_NAMESPACE) {
				deleteRequest.namespace = this.namespace;
			}

			await this.index.delete(deleteRequest);

			this.logger.debug(`${LOG_PREFIXES.PINECONE} Successfully deleted vector ${vectorId}`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.PINECONE} Delete failed`, {
				error: error instanceof Error ? error.message : String(error),
				vectorId,
			});
			throw new VectorStoreError('Failed to delete vector', 'delete', error as Error);
		}
	}

	async deleteCollection(): Promise<void> {
		if (!this.connected || !this.index) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'deleteCollection');
		}

		this.logger.warn(
			`${LOG_PREFIXES.PINECONE} Deleting all vectors in namespace '${this.namespace}' from index '${this.indexName}'`
		);

		try {
			const deleteRequest: any = {
				deleteAll: true,
			};

			if (this.namespace !== DEFAULTS.PINECONE_NAMESPACE) {
				deleteRequest.namespace = this.namespace;
			}

			await this.index.delete(deleteRequest);

			this.logger.info(
				`${LOG_PREFIXES.PINECONE} Successfully deleted all vectors in namespace '${this.namespace}'`
			);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.PINECONE} Delete collection failed`, {
				error: error instanceof Error ? error.message : String(error),
			});
			throw new VectorStoreError('Failed to delete collection', 'deleteCollection', error as Error);
		}
	}

	async list(
		filters?: SearchFilters,
		limit: number = 10000
	): Promise<[VectorStoreResult[], number]> {
		// Pinecone doesn't support direct listing
		// This is a limitation of the Pinecone service
		throw new VectorStoreError(
			'Pinecone does not support listing all vectors directly. Use search with appropriate filters instead.',
			'list'
		);
	}

	// Getter methods
	isConnected(): boolean {
		return this.connected;
	}

	getBackendType(): string {
		return 'pinecone';
	}

	getDimension(): number {
		return this.dimension;
	}

	getCollectionName(): string {
		return this.indexName;
	}

	getNamespace(): string {
		return this.namespace;
	}
}
