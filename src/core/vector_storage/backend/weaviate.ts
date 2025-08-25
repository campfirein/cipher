// Weaviate TypeScript client v2
import { WeaviateClient, ApiKey } from 'weaviate-ts-client';

import type { VectorStore } from './vector-store.js';
import type { SearchFilters, VectorStoreResult, WeaviateBackendConfig } from './types.js';
import { VectorStoreError, VectorStoreConnectionError, VectorDimensionError } from './types.js';
import { Logger, createLogger } from '../../logger/index.js';
import { LOG_PREFIXES, ERROR_MESSAGES } from '../constants.js';
import { env } from '../../env.js';
import { v5 as uuidv5 } from 'uuid';

const weaviate = require("weaviate-ts-client").default;

// UUID v5 namespace for generating deterministic UUIDs from numeric IDs
const WEAVIATE_UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * WeaviateBackend Class
 *
 * Implements the VectorStore interface for Weaviate vector database.
 * Supports both cloud and local Weaviate instances with authentication.
 * 
 * Note: This implementation uses the weaviate-ts-client v2.x API.
 * Make sure to install: npm install weaviate-ts-client
 */
export class WeaviateBackend implements VectorStore {
	private client: WeaviateClient | null = null;
	private readonly config: WeaviateBackendConfig;
	private readonly dimension: number;
	private readonly collectionName: string ;
    private readonly logger: Logger;
	private connected = false;

    private connectionConfig: any = {};
	constructor(config: WeaviateBackendConfig) {
		this.config = config;
		// Sanitize collection name for Weaviate (capitalize first letter, remove hyphens)
		this.collectionName = config.collectionName.toLocaleLowerCase()
        this.collectionName = this.collectionName.charAt(0).toUpperCase() + this.collectionName.slice(1)
		this.dimension = config.dimension;
		this.logger = createLogger({
			level: env.CIPHER_LOG_LEVEL || 'info',
		});

		this.logger.debug(`${LOG_PREFIXES.WEAVIATE} Backend initialized`, {
			collection: this.collectionName,
			dimension: this.dimension,
			url: config.url,
			host: config.host,
			port: config.port,
		});
	}

	/**
	 * Ensure the client is available and connected
	 */
	private ensureClient(): WeaviateClient {
		if (!this.client) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'operation');
		}
		return this.client;
	}

	/**
	 * Convert numeric ID to UUID v5 for Weaviate compatibility
	 */
	private generateUuidFromId(id: number): string {
		return uuidv5(id.toString(), WEAVIATE_UUID_NAMESPACE);
	}

	private validateDimension(vector: number[], operation: string): void {
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
			this.logger.debug(`${LOG_PREFIXES.WEAVIATE} Already connected`);
			return;
		}

		this.logger.debug(`${LOG_PREFIXES.WEAVIATE} Connecting to Weaviate`);

		        try {
            // Configure connection for Weaviate Cloud or local instance
            if (this.config.url) {
                // Weaviate Cloud connection - extract host from URL and use https scheme
                console.log("Connecting to Weaviate Cloud with URL: ", this.config.url);
                
                // For Weaviate Cloud URLs, we need to extract the host and use https scheme
                let host = this.config.url;
                if (host.startsWith('https://')) {
                    host = host.replace('https://', '');
                } else if (host.startsWith('http://')) {
                    host = host.replace('http://', '');
                }
                
                this.connectionConfig = {
                    scheme: 'https',
                    host: host,
                    apiKey: new ApiKey(this.config.apiKey || ''),
                };
            } else if (this.config.host) {
                // Local or custom instance connection
                console.log("Connecting to local/custom Weaviate instance: ", this.config.host);
                let scheme = 'http';
                let host = this.config.host;
                
                if (this.config.host.includes('https://')) {
                    scheme = 'https';
                    host = this.config.host.replace('https://', '');
                } else if (this.config.host.includes('http://')) {
                    scheme = 'http';
                    host = this.config.host.replace('http://', '');
                }
                
                this.connectionConfig = {
                    scheme: scheme,
                    host: host,
                };
                
                // Add API key if provided for local instance
                if (this.config.apiKey) {
                    this.connectionConfig.apiKey = new ApiKey(this.config.apiKey);
                }
            } else {
                throw new VectorStoreConnectionError(
                    'Either url (for Weaviate Cloud) or host (for local instance) must be provided',
                    'weaviate',
                    new Error('Missing connection configuration')
                );
            }
            
            console.log("Connection config: ", this.connectionConfig);
            this.client = weaviate.client(this.connectionConfig);
			// Verify connection
			const isReady = await this.client.misc.liveChecker().do();
			if (!isReady) {
				throw new VectorStoreConnectionError(
					'Weaviate instance is not ready',
					'weaviate',
					new Error('Connection check failed')
				);
			}

			// Check if collection exists, create if not
			await this.ensureCollection();

			this.connected = true;
			this.logger.debug(`${LOG_PREFIXES.WEAVIATE} Successfully connected`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.WEAVIATE} Connection failed`, { error });
			if (error instanceof VectorStoreConnectionError) {
				throw error;
			}
			throw new VectorStoreConnectionError(
				ERROR_MESSAGES.CONNECTION_FAILED,
				'weaviate',
				error as Error
			);
		}
	}

	/**
	 * Ensure the collection exists, create if it doesn't
	 */
	private async ensureCollection(): Promise<void> {
		const client = this.ensureClient();

		try {
			// Check if class exists
			const schema = await client.schema.getter().do();
			let classExists: boolean = false;
            for (const cls of schema.classes) {
                if (cls.class === this.collectionName) {
                    classExists = true;
                    break;
                }
            }

            // Class exists, but the defined schema doesnt match
			if (!classExists) {
				this.logger.debug(`${LOG_PREFIXES.WEAVIATE} Creating class ${this.collectionName}`);

				// Create class schema - matching Milvus structure (id, vector, payload)
				const classObj = {
					class: this.collectionName, //benchmark
					description: `Vector store collection for ${this.collectionName}`,
					properties: [
						{
							name: 'payload',
							dataType: ['text'],
							description: 'JSON string containing all metadata and content',
						},
					],
					vectorizer: 'none', // We provide our own vectors
				};
				await client.schema.classCreator().withClass(classObj).do();

				this.logger.debug(`${LOG_PREFIXES.WEAVIATE} Class created: ${this.collectionName}`);
			} 
            else {
                // Check if the class schema is matching the config, if not, delete the class and create a new one
                const existingClass = schema.classes?.find((cls: any) => cls.class === this.collectionName);
                const expectedPayloadProperty = existingClass?.properties?.find((prop: any) => prop.name === 'payload');
                
                const schemaMatches = expectedPayloadProperty && 
                    expectedPayloadProperty.dataType.includes('text') &&
                    existingClass.properties.length === 1; // Only payload property should exist
                
                if (!schemaMatches) {
                    this.logger.warn(`${LOG_PREFIXES.WEAVIATE} Class ${this.collectionName} schema doesn't match expected structure. Recreating...`);
                    
                    // Delete the existing class
                    await client.schema.classDeleter().withClassName(this.collectionName).do();
                    this.logger.debug(`${LOG_PREFIXES.WEAVIATE} Deleted existing class: ${this.collectionName}`);
                    
                    // Create class schema - matching Milvus structure (id, vector, payload)
                    const classObj = {
                        class: this.collectionName,
                        description: `Vector store collection for ${this.collectionName}`,
                        properties: [
                            {
                                name: 'payload',
                                dataType: ['text'],
                                description: 'JSON string containing all metadata and content',
                            },
                        ],
                        vectorizer: 'none', // We provide our own vectors
                    };
                    
                    // Recreate the class with correct schema
                    await client.schema.classCreator().withClass(classObj).do();
                    this.logger.debug(`${LOG_PREFIXES.WEAVIATE} Recreated class with correct schema: ${this.collectionName}`);
                } else {
                    this.logger.debug(`${LOG_PREFIXES.WEAVIATE} Class already exists with correct schema: ${this.collectionName}`);
                }
			}
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.WEAVIATE} Failed to ensure class`, { error });
			throw error;
		}
	}

	async insert(vectors: number[][], ids: number[], payloads: Record<string, any>[]): Promise<void> {
		if (!this.connected) {
			return Promise.reject(new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'insert'));
		}

		if (vectors.length !== ids.length || vectors.length !== payloads.length) {
			return Promise.reject(
				new VectorStoreError('Vectors, IDs, and payloads must have the same length', 'insert')
			);
		}

		// Validate all vector dimensions
		for (const vector of vectors) {
			this.validateDimension(vector, 'insert');
		}

		try {
			const client = this.ensureClient();

			// Prepare objects for batch insertion - matching Milvus structure
			const batcher = client.batch.objectsBatcher();
			
			for (let i = 0; i < vectors.length; i++) {
				const obj = {
					class: this.collectionName,
					id: this.generateUuidFromId(ids[i]),
					properties: {
						payload: JSON.stringify(payloads[i] || {}),
					},
					vector: vectors[i],
				};

				batcher.withObject(obj);
			}

			// Execute batch insertion
			const response = await batcher.do();

			// Check for errors
			if (response && response.some((r: any) => r.result?.errors)) {
				const errors = response
					.filter((r: any) => r.result?.errors)
					.map((r: any) => r.result.errors.error.map((e: any) => e.message).join(', '))
					.join('; ');
				throw new VectorStoreError(`Insert failed: ${errors}`, 'insert');
			}

			this.logger.debug(`${LOG_PREFIXES.WEAVIATE} Inserted ${vectors.length} vectors`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.WEAVIATE} Insert failed`, { error });
			throw new VectorStoreError('Failed to insert vectors', 'insert', error as Error);
		}
	}

	async search(
		query: number[],
		limit: number = 10,
		filters?: SearchFilters
	): Promise<VectorStoreResult[]> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'search');
		}

		this.validateDimension(query, 'search');

		try {
			const client = this.ensureClient();

			// Build search query
			let searchBuilder = client.graphql
				.get()
				.withClassName(this.collectionName)
				.withNearVector({ vector: query })
				.withLimit(limit)
				.withFields('_additional { id certainty distance } payload');

			// Apply filters if provided
			if (filters) {
				const whereFilter = this.buildWhereFilter(filters);
				if (whereFilter) {
					searchBuilder = searchBuilder.withWhere(whereFilter);
				}
			}

			const response = await searchBuilder.do();

			// Transform results
			const results = response.data.Get[this.collectionName] || [];
			return results.map((obj: any) => ({
				id: parseInt(obj._additional.id) || 0,
				score: obj._additional.certainty || obj._additional.distance || 0,
				payload: obj.payload ? JSON.parse(obj.payload) : {},
			}));
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.WEAVIATE} Search failed`, { error });
			throw new VectorStoreError(ERROR_MESSAGES.SEARCH_FAILED, 'search', error as Error);
		}
	}

	async get(vectorId: number): Promise<VectorStoreResult | null> {
		if (!this.connected) {
			return Promise.reject(new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'get'));
		}

		try {
			const client = this.ensureClient();

			const response = await client.data
				.getterById()
				.withClassName(this.collectionName)
				.withId(this.generateUuidFromId(vectorId))
				.withVector()
				.do();

			if (!response) {
				return null;
			}

			return {
				id: vectorId,
				vector: response.vector || [],
				payload: response.properties?.payload && typeof response.properties.payload === 'string' 
					? JSON.parse(response.properties.payload) : {},
				score: 1.0,
			};
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.WEAVIATE} Get failed`, { error });
			throw new VectorStoreError('Failed to retrieve vector', 'get', error as Error);
		}
	}

	async update(vectorId: number, vector: number[], payload: Record<string, any>): Promise<void> {
		if (!this.connected) {
			return Promise.reject(new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'update'));
		}

		this.validateDimension(vector, 'update');

		try {
			const client = this.ensureClient();

			await client.data
				.updater()
				.withClassName(this.collectionName)
				.withId(this.generateUuidFromId(vectorId))
				.withProperties({
					payload: JSON.stringify(payload),
				})
				.withVector(vector)
				.do();

			this.logger.debug(`${LOG_PREFIXES.WEAVIATE} Updated vector ${vectorId}`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.WEAVIATE} Update failed`, { error });
			throw new VectorStoreError('Failed to update vector', 'update', error as Error);
		}
	}

	async delete(vectorId: number): Promise<void> {
		if (!this.connected) {
			return Promise.reject(new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'delete'));
		}

		try {
			const client = this.ensureClient();

			await client.data
				.deleter()
				.withClassName(this.collectionName)
				.withId(this.generateUuidFromId(vectorId))
				.do();

			this.logger.debug(`${LOG_PREFIXES.WEAVIATE} Deleted vector ${vectorId}`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.WEAVIATE} Delete failed`, { error });
			throw new VectorStoreError('Failed to delete vector', 'delete', error as Error);
		}
	}

	async deleteCollection(): Promise<void> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'deleteCollection');
		}

		try {
			const client = this.ensureClient();
			await client.schema.classDeleter().withClassName(this.collectionName).do();
			this.logger.info(`${LOG_PREFIXES.WEAVIATE} Deleted collection ${this.collectionName}`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.WEAVIATE} Delete collection failed`, { error });
			throw new VectorStoreError('Failed to delete collection', 'deleteCollection', error as Error);
		}
	}

	async list(
		filters?: SearchFilters,
		limit: number = 10000
	): Promise<[VectorStoreResult[], number]> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'list');
		}

		try {
			const client = this.ensureClient();

			let queryBuilder = client.graphql
				.get()
				.withClassName(this.collectionName)
				.withLimit(limit)
				.withFields('_additional { id } payload');

			// Apply filters if provided
			if (filters) {
				const whereFilter = this.buildWhereFilter(filters);
				if (whereFilter) {
					queryBuilder = queryBuilder.withWhere(whereFilter);
				}
			}

			const response = await queryBuilder.do();

			const results = response.data.Get[this.collectionName] || [];
			const transformedResults = results.map((obj: any) => ({
				id: parseInt(obj._additional.id) || 0,
				vector: [], // Vector not included in list operations
				payload: obj.payload ? JSON.parse(obj.payload) : {},
				score: 1.0,
			}));

			return [transformedResults, transformedResults.length];
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.WEAVIATE} List failed`, { error });
			throw new VectorStoreError('Failed to list vectors', 'list', error as Error);
		}
	}

	async disconnect(): Promise<void> {
		// weaviate-ts-client v2 doesn't have an explicit close method
		this.client = null;
		this.connected = false;
		this.logger.info(`${LOG_PREFIXES.WEAVIATE} Disconnected`);
	}

	isConnected(): boolean {
		return this.connected;
	}

	getBackendType(): string {
		return 'weaviate';
	}

	getDimension(): number {
		return this.dimension;
	}

	getCollectionName(): string {
		return this.collectionName;
	}

	async listCollections(): Promise<string[]> {
		if (!this.connected) {
			return Promise.reject(new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'listCollections'));
		}

		try {
			const client = this.ensureClient();
			const schema = await client.schema.getter().do();
			return schema.classes?.map((cls: any) => cls.class) || [];
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.WEAVIATE} List collections failed`, { error });
			throw new VectorStoreError('Failed to list collections', 'listCollections', error as Error);
		}
	}

	/**
	 * Build Weaviate where filter from SearchFilters
	 */
	private buildWhereFilter(filters: SearchFilters): any {
		const conditions: any[] = [];

		for (const [key, value] of Object.entries(filters)) {
			if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
				conditions.push({
					path: ['payload'],
					operator: 'Like',
					valueText: `*"${key}":"${value}"*`,
				});
			} else if (value && typeof value === 'object') {
				if ('any' in value && Array.isArray(value.any)) {
					// Handle 'in' operator - create OR conditions for each value
					const orConditions = value.any.map(v => ({
						path: ['payload'],
						operator: 'Like',
						valueText: `*"${key}":"${v}"*`,
					}));
					if (orConditions.length > 1) {
						conditions.push({ operator: 'Or', operands: orConditions });
					} else if (orConditions.length === 1) {
						conditions.push(orConditions[0]);
					}
				} else {
					// Handle comparison operators - these are more complex with JSON strings
					// For simplicity, we'll use Like patterns for now
					if ('gte' in value) {
						conditions.push({
							path: ['payload'],
							operator: 'Like',
							valueText: `*"${key}":*`,
						});
					}
					if ('lte' in value) {
						conditions.push({
							path: ['payload'],
							operator: 'Like',
							valueText: `*"${key}":*`,
						});
					}
					if ('gt' in value) {
						conditions.push({
							path: ['payload'],
							operator: 'Like',
							valueText: `*"${key}":*`,
						});
					}
					if ('lt' in value) {
						conditions.push({
							path: ['payload'],
							operator: 'Like',
							valueText: `*"${key}":*`,
						});
					}
				}
			}
		}

		if (conditions.length === 0) {
			return undefined;
		} else if (conditions.length === 1) {
			return conditions[0];
		} else {
			return { operator: 'And', operands: conditions };
		}
	}
} 