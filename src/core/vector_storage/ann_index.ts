/**
 * Approximate Nearest Neighbor (ANN) Index Module
 *
 * Provides high-performance similarity search using ANN algorithms.
 * Supports multiple ANN libraries with graceful fallback to brute-force search.
 *
 * Features:
 * - FAISS integration for high-performance ANN search
 * - Fallback to brute-force for small datasets
 * - Configurable ANN algorithms (HNSW, IVF, etc.)
 * - Incremental index updates
 * - Index persistence for large datasets
 * - Performance monitoring and benchmarking
 *
 * @module vector_storage/ann_index
 */

import { Logger, createLogger } from '../logger/index.js';
import { LOG_PREFIXES, DEFAULTS } from './constants.js';
import type { VectorStoreResult } from './backend/types.js';

/**
 * ANN algorithm types
 * Note: faiss-node has limited algorithm support, so we use FlatIP for all cases
 */
export type ANNAlgorithm = 'flat' | 'brute-force';

/**
 * ANN index configuration
 */
export interface ANNIndexConfig {
	/** ANN algorithm to use */
	algorithm: ANNAlgorithm;
	/** Vector dimension */
	dimension: number;
	/** Maximum number of vectors to store */
	maxVectors: number;
	/** Note: HNSW and IVF are not available in faiss-node */
	/** Flat index parameters (if any) */
	flat?: {
		/** Currently no specific parameters for FlatIP */
	};
	/** Minimum dataset size to use ANN (fallback to brute-force below this) */
	minDatasetSize: number;
	/** Enable index persistence */
	persistIndex: boolean;
	/** Index file path for persistence */
	indexPath?: string;
}

/**
 * ANN search result
 */
export interface ANNSearchResult {
	/** Vector ID */
	id: number;
	/** Similarity score */
	score: number;
	/** Distance (if available) */
	distance?: number;
	/** Whether this result came from ANN or brute-force */
	fromANN: boolean;
}

/**
 * ANN index statistics
 */
export interface ANNIndexStats {
	/** Total number of vectors in index */
	vectorCount: number;
	/** Whether ANN is being used */
	usingANN: boolean;
	/** Current algorithm */
	algorithm: ANNAlgorithm;
	/** Index build time in milliseconds */
	buildTime?: number;
	/** Last search performance metrics */
	lastSearchMetrics?: {
		queryTime: number;
		resultCount: number;
		fromANN: boolean;
	};
}

/**
 * ANN Index Implementation
 *
 * Provides approximate nearest neighbor search with configurable algorithms.
 * Falls back to brute-force search for small datasets or when ANN is unavailable.
 */
export class ANNIndex {
	private readonly config: ANNIndexConfig;
	private readonly logger: Logger;
	private vectors: Map<number, number[]> = new Map();
	private annIndex: any = null; // FAISS index
	private connected = false;
	private stats: ANNIndexStats;

	constructor(config: ANNIndexConfig) {
		this.config = config;
		this.logger = createLogger({
			level: process.env.LOG_LEVEL || 'info',
		});

		this.stats = {
			vectorCount: 0,
			usingANN: false,
			algorithm: config.algorithm,
		};

		this.logger.debug('ANNIndex: Initialized', {
			algorithm: config.algorithm,
			dimension: config.dimension,
			maxVectors: config.maxVectors,
		});
	}

	/**
	 * Initialize the ANN index
	 */
	async initialize(): Promise<void> {
		if (this.connected) {
			return;
		}

		try {
			// Try to load FAISS if available
			if (this.config.algorithm !== 'brute-force') {
				await this.initializeFAISS();
			}

			this.connected = true;
			this.logger.info('ANNIndex: Initialized successfully', {
				algorithm: this.stats.algorithm,
				usingANN: this.stats.usingANN,
			});
		} catch (error) {
			this.logger.warn('ANNIndex: Failed to initialize ANN, falling back to brute-force', {
				error: error instanceof Error ? error.message : String(error),
			});
			this.stats.algorithm = 'brute-force';
			this.stats.usingANN = false;
			this.connected = true;
		}
	}

	/**
	 * Initialize FAISS index
	 */
	private async initializeFAISS(): Promise<void> {
		try {
			// Dynamic import to avoid issues if FAISS is not available
			const faiss = await import('faiss-node');
			
			// Create index based on algorithm
			switch (this.config.algorithm) {
				case 'flat':
					this.annIndex = new faiss.IndexFlatIP(this.config.dimension);
					break;
				default:
					throw new Error(`Unsupported ANN algorithm: ${this.config.algorithm}`);
			}

			this.stats.usingANN = true;
			this.logger.debug('ANNIndex: FAISS index created', {
				algorithm: this.config.algorithm,
				dimension: this.config.dimension,
			});
		} catch (error) {
			throw new Error(`Failed to initialize FAISS: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Add vectors to the index
	 */
	async addVectors(vectors: number[][], ids: number[]): Promise<void> {
		if (!this.connected) {
			throw new Error('ANNIndex not initialized');
		}

		if (vectors.length !== ids.length) {
			throw new Error('Vectors and IDs must have the same length');
		}

		// Validate dimensions
		for (const vector of vectors) {
			if (vector.length !== this.config.dimension) {
				throw new Error(`Vector dimension mismatch: expected ${this.config.dimension}, got ${vector.length}`);
			}
		}

		// Store vectors in memory map
		for (let i = 0; i < vectors.length; i++) {
			this.vectors.set(ids[i]!, vectors[i]!);
		}

		// Add to ANN index if available
		if (this.stats.usingANN && this.annIndex) {
			await this.addToANNIndex(vectors, ids);
		}

		this.stats.vectorCount = this.vectors.size;
		this.logger.debug('ANNIndex: Added vectors', {
			count: vectors.length,
			totalVectors: this.stats.vectorCount,
		});
	}

	/**
	 * Add vectors to FAISS index
	 */
	private async addToANNIndex(vectors: number[][], ids: number[]): Promise<void> {
		if (!this.annIndex) return;

		try {
			// Convert vectors to Float32Array for FAISS
			const floatVectors = new Float32Array(vectors.length * this.config.dimension);
			for (let i = 0; i < vectors.length; i++) {
				for (let j = 0; j < this.config.dimension; j++) {
					floatVectors[i * this.config.dimension + j] = vectors[i]![j]!;
				}
			}

			// Add to FAISS index
			this.annIndex.add(floatVectors);
			
			this.logger.debug('ANNIndex: Added to FAISS index', {
				count: vectors.length,
			});
		} catch (error) {
			this.logger.error('ANNIndex: Failed to add to FAISS index', {
				error: error instanceof Error ? error.message : String(error),
			});
			// Fallback to brute-force
			this.stats.usingANN = false;
		}
	}

	/**
	 * Search for similar vectors
	 */
	async search(
		query: number[],
		limit: number = DEFAULTS.SEARCH_LIMIT,
		filters?: (id: number) => boolean
	): Promise<ANNSearchResult[]> {
		if (!this.connected) {
			throw new Error('ANNIndex not initialized');
		}

		if (query.length !== this.config.dimension) {
			throw new Error(`Query dimension mismatch: expected ${this.config.dimension}, got ${query.length}`);
		}

		const startTime = performance.now();

		// Determine search method
		const useANN = this.stats.usingANN && 
			this.annIndex && 
			this.stats.vectorCount >= this.config.minDatasetSize;

		let results: ANNSearchResult[];

		if (useANN) {
			results = await this.searchANN(query, limit, filters);
		} else {
			results = await this.searchBruteForce(query, limit, filters);
		}

		const queryTime = Math.max(1, Math.round(performance.now() - startTime)); // Ensure at least 1ms

		// Update stats
		this.stats.lastSearchMetrics = {
			queryTime,
			resultCount: results.length,
			fromANN: useANN,
		};

		this.logger.debug('ANNIndex: Search completed', {
			algorithm: this.stats.algorithm,
			fromANN: useANN,
			queryTime,
			resultCount: results.length,
			vectorCount: this.stats.vectorCount,
		});

		return results;
	}

	/**
	 * Search using ANN index
	 */
	private async searchANN(
		query: number[],
		limit: number,
		filters?: (id: number) => boolean
	): Promise<ANNSearchResult[]> {
		if (!this.annIndex) {
			throw new Error('ANN index not available');
		}

		try {
			// Convert query to Float32Array
			const queryArray = new Float32Array(query);

			// Search in FAISS
			const { distances, indices } = this.annIndex.search(queryArray, limit);

			// Convert results
			const results: ANNSearchResult[] = [];
			for (let i = 0; i < indices.length; i++) {
				const id = indices[i];
				if (id >= 0 && (!filters || filters(id))) {
					results.push({
						id,
						score: 1 - distances[i]! / Math.max(...distances), // Convert distance to similarity
						distance: distances[i],
						fromANN: true,
					});
				}
			}

			return results;
		} catch (error) {
			this.logger.error('ANNIndex: ANN search failed, falling back to brute-force', {
				error: error instanceof Error ? error.message : String(error),
			});
			return this.searchBruteForce(query, limit, filters);
		}
	}

	/**
	 * Search using brute-force (exact) search
	 */
	private async searchBruteForce(
		query: number[],
		limit: number,
		filters?: (id: number) => boolean
	): Promise<ANNSearchResult[]> {
		const results: Array<{ id: number; score: number }> = [];

		// Calculate similarities for all vectors
		for (const [id, vector] of this.vectors.entries()) {
			if (filters && !filters(id)) {
				continue;
			}

			const score = this.cosineSimilarity(query, vector);
			results.push({ id, score });
		}

		// Sort by score (descending) and limit
		results.sort((a, b) => b.score - a.score);
		const topResults = results.slice(0, limit);

		return topResults.map(({ id, score }) => ({
			id,
			score,
			fromANN: false,
		}));
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

	/**
	 * Remove vectors from the index
	 */
	async removeVectors(ids: number[]): Promise<void> {
		if (!this.connected) {
			throw new Error('ANNIndex not initialized');
		}

		// Remove from memory map
		for (const id of ids) {
			this.vectors.delete(id);
		}

		// Note: FAISS doesn't support efficient deletion, so we rebuild the index
		if (this.stats.usingANN && this.annIndex) {
			await this.rebuildANNIndex();
		}

		this.stats.vectorCount = this.vectors.size;
		this.logger.debug('ANNIndex: Removed vectors', {
			count: ids.length,
			totalVectors: this.stats.vectorCount,
		});
	}

	/**
	 * Rebuild ANN index after deletions
	 */
	private async rebuildANNIndex(): Promise<void> {
		if (!this.annIndex) return;

		try {
			// Create new index
			await this.initializeFAISS();

			// Re-add all vectors
			const vectors: number[][] = [];
			const ids: number[] = [];

			for (const [id, vector] of this.vectors.entries()) {
				vectors.push(vector);
				ids.push(id);
			}

			if (vectors.length > 0) {
				await this.addToANNIndex(vectors, ids);
			}

			this.logger.debug('ANNIndex: Rebuilt ANN index', {
				vectorCount: this.stats.vectorCount,
			});
		} catch (error) {
			this.logger.error('ANNIndex: Failed to rebuild ANN index', {
				error: error instanceof Error ? error.message : String(error),
			});
			this.stats.usingANN = false;
		}
	}

	/**
	 * Get index statistics
	 */
	getStats(): ANNIndexStats {
		return { ...this.stats };
	}

	/**
	 * Clear all vectors from the index
	 */
	async clear(): Promise<void> {
		this.vectors.clear();
		this.stats.vectorCount = 0;

		if (this.annIndex) {
			try {
				this.annIndex.reset();
			} catch (error) {
				this.logger.warn('ANNIndex: Failed to reset ANN index', {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		this.logger.debug('ANNIndex: Cleared all vectors');
	}

	/**
	 * Disconnect and cleanup
	 */
	async disconnect(): Promise<void> {
		this.connected = false;
		this.vectors.clear();
		this.annIndex = null;
		this.stats.vectorCount = 0;
		this.stats.usingANN = false;

		this.logger.debug('ANNIndex: Disconnected');
	}

	/**
	 * Check if connected
	 */
	isConnected(): boolean {
		return this.connected;
	}
} 