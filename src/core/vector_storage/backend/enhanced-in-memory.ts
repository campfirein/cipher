/**
 * Enhanced In-Memory Vector Store Backend with ANN Support
 *
 * High-performance in-memory implementation with approximate nearest neighbor search.
 * Integrates ANN algorithms for sublinear search performance on large datasets.
 *
 * Features:
 * - FAISS-based ANN search for high performance
 * - Graceful fallback to brute-force for small datasets
 * - Configurable ANN algorithms (HNSW, IVF, etc.)
 * - Metadata filtering support
 * - Performance monitoring and statistics
 *
 * @module vector_storage/backend/enhanced-in-memory
 */

import type { VectorStore } from './vector-store.js';
import type { SearchFilters, VectorStoreResult, InMemoryBackendConfig } from './types.js';
import { VectorStoreError, VectorDimensionError } from './types.js';
import { Logger, createLogger } from '../../logger/index.js';
import { LOG_PREFIXES, DEFAULTS, ERROR_MESSAGES } from '../constants.js';
import { ANNIndex, type ANNIndexConfig, type ANNAlgorithm } from '../ann_index.js';

/**
 * Enhanced in-memory vector entry
 */
interface VectorEntry {
	id: number;
	vector: number[];
	payload: Record<string, any>;
}

/**
 * Enhanced InMemoryBackend Configuration
 */
export interface EnhancedInMemoryConfig {
	/** Backend type */
	type: 'enhanced-in-memory';
	/** Collection name */
	collectionName: string;
	/** Vector dimension */
	dimension: number;
	/** Maximum number of vectors to store */
	maxVectors?: number;
	/** ANN algorithm to use */
	annAlgorithm?: ANNAlgorithm;
	/** Minimum dataset size to use ANN */
	annMinDatasetSize?: number;
	/** Note: HNSW and IVF are not available in faiss-node */
	/** Flat index parameters (if any) */
	annFlat?: {
		/** Currently no specific parameters for FlatIP */
	};
	/** Enable ANN index persistence */
	annPersistIndex?: boolean;
	/** ANN index file path */
	annIndexPath?: string;
}

/**
 * Enhanced InMemoryBackend Class
 *
 * Implements the VectorStore interface using in-memory storage with ANN acceleration.
 *
 * @example
 * ```typescript
 * const store = new EnhancedInMemoryBackend({
 *   type: 'in-memory',
 *   collectionName: 'test',
 *   dimension: 1536,
 *   maxVectors: 10000,
 *   annAlgorithm: 'hnsw',
 *   annMinDatasetSize: 1000
 * });
 *
 * await store.connect();
 * await store.insert([vector], [1], [{ title: 'Test' }]);
 * const results = await store.search(queryVector, 5);
 * ```
 */
export class EnhancedInMemoryBackend implements VectorStore {
	private readonly config: EnhancedInMemoryConfig;
	private readonly collectionName: string;
	private readonly dimension: number;
	private readonly maxVectors: number;
	private readonly logger: Logger;
	private connected = false;

	// Storage
	private vectors: Map<number, VectorEntry> = new Map();
	private annIndex: ANNIndex | null = null;

	constructor(config: EnhancedInMemoryConfig) {
		this.config = config;
		this.collectionName = config.collectionName;
		this.dimension = config.dimension;
		this.maxVectors = config.maxVectors || 10000;
		this.logger = createLogger({
			level: process.env.LOG_LEVEL || 'info',
		});

		this.logger.debug(`${LOG_PREFIXES.MEMORY} Enhanced In-Memory initialized`, {
			collection: this.collectionName,
			dimension: this.dimension,
			maxVectors: this.maxVectors,
			annAlgorithm: config.annAlgorithm || 'brute-force',
		});
	}

	/**
	 * Initialize ANN index if configured
	 */
	private async initializeANNIndex(): Promise<void> {
		if (!this.config.annAlgorithm || this.config.annAlgorithm === 'brute-force') {
			return;
		}

		const annConfig: ANNIndexConfig = {
			algorithm: this.config.annAlgorithm,
			dimension: this.dimension,
			maxVectors: this.maxVectors,
			minDatasetSize: this.config.annMinDatasetSize || 1000,
			persistIndex: this.config.annPersistIndex || false,
			indexPath: this.config.annIndexPath,
			flat: this.config.annFlat,
		};

		this.annIndex = new ANNIndex(annConfig);
		await this.annIndex.initialize();

		this.logger.info(`${LOG_PREFIXES.MEMORY} ANN index initialized`, {
			algorithm: this.config.annAlgorithm,
			usingANN: this.annIndex.getStats().usingANN,
		});
	}

	/**
	 * Deep clone an object to prevent reference issues
	 */
	private deepClone<T>(obj: T): T {
		if (obj === null || typeof obj !== 'object') {
			return obj;
		}

		if (Array.isArray(obj)) {
			return obj.map(item => this.deepClone(item)) as unknown as T;
		}

		const cloned = {} as T;
		for (const key in obj) {
			if (Object.prototype.hasOwnProperty.call(obj, key)) {
				cloned[key] = this.deepClone(obj[key]);
			}
		}

		return cloned;
	}

	/**
	 * Check if a vector entry matches the given filters
	 */
	private matchesFilters(entry: VectorEntry, filters?: SearchFilters): boolean {
		if (!filters) return true;

		for (const [key, value] of Object.entries(filters)) {
			const payloadValue = entry.payload[key];

			// Handle null/undefined
			if (value === null || value === undefined) continue;

			// Handle range queries
			if (
				typeof value === 'object' &&
				!Array.isArray(value) &&
				('gte' in value || 'gt' in value || 'lte' in value || 'lt' in value)
			) {
				if (typeof payloadValue !== 'number') return false;

				if ('gte' in value && payloadValue < value.gte!) return false;
				if ('gt' in value && payloadValue <= value.gt!) return false;
				if ('lte' in value && payloadValue > value.lte!) return false;
				if ('lt' in value && payloadValue >= value.lt!) return false;
			}
			// Handle array filters
			else if (
				typeof value === 'object' &&
				!Array.isArray(value) &&
				('any' in value || 'all' in value)
			) {
				if ('any' in value && Array.isArray(value.any)) {
					// Check if payload value matches any of the values
					if (!value.any.includes(payloadValue)) return false;
				}
			}
			// Handle exact match
			else {
				if (payloadValue !== value) return false;
			}
		}

		return true;
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
	 * Create filter function for ANN search
	 */
	private createFilterFunction(filters?: SearchFilters): (id: number) => boolean {
		return (id: number) => {
			const entry = this.vectors.get(id);
			if (!entry) return false;
			return this.matchesFilters(entry, filters);
		};
	}

	// VectorStore implementation

	async insert(vectors: number[][], ids: number[], payloads: Record<string, any>[]): Promise<void> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'insert');
		}

		// Validate inputs
		if (vectors.length !== ids.length || vectors.length !== payloads.length) {
			throw new VectorStoreError('Vectors, IDs, and payloads must have the same length', 'insert');
		}

		// Check capacity
		if (this.vectors.size + vectors.length > this.maxVectors) {
			throw new VectorStoreError(
				`Insertion would exceed maximum vector capacity of ${this.maxVectors}`,
				'insert'
			);
		}

		// Validate dimensions and insert
		for (let i = 0; i < vectors.length; i++) {
			const vector = vectors[i];
			const id = ids[i];
			const payload = payloads[i];

			if (!vector || typeof id !== 'number' || !Number.isInteger(id) || !payload) {
				throw new VectorStoreError(
					`Invalid input at index ${i}: vector, integer id, and payload are required`,
					'insert'
				);
			}

			this.validateDimension(vector, 'insert');

			this.vectors.set(id, {
				id: id,
				vector: [...vector], // Clone to prevent external modification
				payload: this.deepClone(payload), // Deep clone payload
			});
		}

		// Add to ANN index if available
		if (this.annIndex) {
			try {
				await this.annIndex.addVectors(vectors, ids);
			} catch (error) {
				this.logger.warn(`${LOG_PREFIXES.INDEX} Failed to add to ANN index`, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		this.logger.debug(`${LOG_PREFIXES.INDEX} Inserted ${vectors.length} vectors`);
	}

	async search(
		query: number[],
		limit: number = DEFAULTS.SEARCH_LIMIT,
		filters?: SearchFilters
	): Promise<VectorStoreResult[]> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'search');
		}

		this.validateDimension(query, 'search');

		const startTime = Date.now();

		// Use ANN search if available
		if (this.annIndex) {
			try {
				const filterFn = this.createFilterFunction(filters);
				const annResults = await this.annIndex.search(query, limit, filterFn);

				// Convert ANN results to VectorStoreResult format
				const results: VectorStoreResult[] = [];
				for (const annResult of annResults) {
					const entry = this.vectors.get(annResult.id);
					if (entry) {
						results.push({
							id: entry.id,
							vector: [...entry.vector],
							payload: this.deepClone(entry.payload),
							score: annResult.score,
						});
					}
				}

				const queryTime = Date.now() - startTime;
				const stats = this.annIndex.getStats();

				this.logger.debug(`${LOG_PREFIXES.SEARCH} ANN search completed`, {
					resultCount: results.length,
					queryTime,
					fromANN: stats.lastSearchMetrics?.fromANN || false,
					algorithm: stats.algorithm,
				});

				return results;
			} catch (error) {
				this.logger.warn(`${LOG_PREFIXES.SEARCH} ANN search failed, falling back to brute-force`, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		// Fallback to brute-force search
		return this.searchBruteForce(query, limit, filters);
	}

	/**
	 * Brute-force search implementation
	 */
	private async searchBruteForce(
		query: number[],
		limit: number,
		filters?: SearchFilters
	): Promise<VectorStoreResult[]> {
		const startTime = Date.now();

		// Calculate similarities for all vectors
		const results: Array<{ entry: VectorEntry; score: number }> = [];

		for (const entry of this.vectors.values()) {
			// Apply filters
			if (!this.matchesFilters(entry, filters)) {
				continue;
			}

			// Calculate similarity
			const score = this.cosineSimilarity(query, entry.vector);
			results.push({ entry, score });
		}

		// Sort by score (descending) and limit
		results.sort((a, b) => b.score - a.score);
		const topResults = results.slice(0, limit);

		// Format results
		const formattedResults = topResults.map(({ entry, score }) => ({
			id: entry.id,
			vector: [...entry.vector],
			payload: this.deepClone(entry.payload),
			score,
		}));

		const queryTime = Date.now() - startTime;

		this.logger.debug(`${LOG_PREFIXES.SEARCH} Brute-force search completed`, {
			resultCount: formattedResults.length,
			queryTime,
			totalVectors: this.vectors.size,
		});

		return formattedResults;
	}

	/**
	 * Calculate cosine similarity between two vectors
	 */
	private cosineSimilarity(a: number[], b: number[]): number {
		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		const minLength = Math.min(a.length, b.length);
		for (let i = 0; i < minLength; i++) {
			const aVal = a[i]!;
			const bVal = b[i]!;
			dotProduct += aVal * bVal;
			normA += aVal * aVal;
			normB += bVal * bVal;
		}

		normA = Math.sqrt(normA);
		normB = Math.sqrt(normB);

		if (normA === 0 || normB === 0) {
			return 0;
		}

		return dotProduct / (normA * normB);
	}

	async get(vectorId: number): Promise<VectorStoreResult | null> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'get');
		}

		const entry = this.vectors.get(vectorId);
		if (!entry) {
			return null;
		}

		return {
			id: entry.id,
			vector: [...entry.vector],
			payload: this.deepClone(entry.payload),
			score: 1.0, // Perfect match for direct retrieval
		};
	}

	async update(vectorId: number, vector: number[], payload: Record<string, any>): Promise<void> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'update');
		}

		this.validateDimension(vector, 'update');

		if (!this.vectors.has(vectorId)) {
			throw new VectorStoreError(`Vector with ID ${vectorId} not found`, 'update');
		}

		this.vectors.set(vectorId, {
			id: vectorId,
			vector: [...vector],
			payload: this.deepClone(payload),
		});

		// Update ANN index if available
		if (this.annIndex) {
			try {
				// Remove old vector and add new one
				await this.annIndex.removeVectors([vectorId]);
				await this.annIndex.addVectors([vector], [vectorId]);
			} catch (error) {
				this.logger.warn(`${LOG_PREFIXES.BACKEND} Failed to update ANN index`, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		this.logger.debug(`${LOG_PREFIXES.BACKEND} Updated vector ${vectorId}`);
	}

	async delete(vectorId: number): Promise<void> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'delete');
		}

		if (!this.vectors.has(vectorId)) {
			this.logger.warn(`${LOG_PREFIXES.BACKEND} Vector ${vectorId} not found for deletion`);
			return;
		}

		this.vectors.delete(vectorId);

		// Remove from ANN index if available
		if (this.annIndex) {
			try {
				await this.annIndex.removeVectors([vectorId]);
			} catch (error) {
				this.logger.warn(`${LOG_PREFIXES.BACKEND} Failed to remove from ANN index`, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		this.logger.debug(`${LOG_PREFIXES.BACKEND} Deleted vector ${vectorId}`);
	}

	async deleteCollection(): Promise<void> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'deleteCollection');
		}

		const count = this.vectors.size;
		this.vectors.clear();

		// Clear ANN index if available
		if (this.annIndex) {
			try {
				await this.annIndex.clear();
			} catch (error) {
				this.logger.warn(`${LOG_PREFIXES.BACKEND} Failed to clear ANN index`, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		this.logger.info(
			`${LOG_PREFIXES.BACKEND} Deleted collection ${this.collectionName} with ${count} vectors`
		);
	}

	async list(filters?: SearchFilters, limit: number = 100): Promise<[VectorStoreResult[], number]> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'list');
		}

		const results: VectorStoreResult[] = [];
		let count = 0;

		for (const entry of this.vectors.values()) {
			if (this.matchesFilters(entry, filters)) {
				count++;
				if (results.length < limit) {
					results.push({
						id: entry.id,
						vector: [...entry.vector],
						payload: this.deepClone(entry.payload),
						score: 1.0, // Default score for list operations
					});
				}
			}
		}

		this.logger.info(`${LOG_PREFIXES.BACKEND} Listed ${results.length} of ${count} vectors`);

		return [results, count];
	}

	async connect(): Promise<void> {
		if (this.connected) {
			this.logger.debug(`${LOG_PREFIXES.MEMORY} Already connected`);
			return;
		}

		// Validate dimension
		if (this.dimension <= 0) {
			throw new VectorStoreError('Invalid dimension: must be positive', 'connect');
		}

		// Initialize ANN index
		await this.initializeANNIndex();

		this.connected = true;
		this.logger.debug(`${LOG_PREFIXES.MEMORY} Connected (enhanced in-memory)`);
	}

	async disconnect(): Promise<void> {
		if (!this.connected) {
			this.logger.debug(`${LOG_PREFIXES.MEMORY} Already disconnected`);
			return;
		}

		// Disconnect ANN index
		if (this.annIndex) {
			await this.annIndex.disconnect();
		}

		this.connected = false;
		this.vectors.clear();
		this.logger.info(`${LOG_PREFIXES.MEMORY} Disconnected and cleared data`);
	}

	isConnected(): boolean {
		return this.connected;
	}

	getBackendType(): string {
		return 'enhanced-in-memory';
	}

	getDimension(): number {
		return this.dimension;
	}

	getCollectionName(): string {
		return this.collectionName;
	}

	/**
	 * Get ANN index statistics
	 */
	getANNStats() {
		return this.annIndex?.getStats();
	}
}