/**
 * In-Memory Vector Store Backend
 *
 * Simple in-memory implementation of the VectorStore interface.
 * Used for development, testing, and as a fallback when external stores are unavailable.
 *
 * Features:
 * - Fast local similarity search
 * - No external dependencies
 * - Automatic memory management with max vector limit
 * - Cosine similarity for search
 *
 * Limitations:
 * - Data is lost on process restart
 * - Limited by available memory
 * - No distributed capabilities
 *
 * @module vector_storage/backend/in-memory
 */

import { VectorStore, VectorStoreResult, SearchFilters, InMemoryBackendConfig } from './types.js';
import { VectorStoreError } from './types.js';
import { Logger, createLogger } from '../../logger/index.js';
import { LOG_PREFIXES, DEFAULTS, ERROR_MESSAGES } from '../constants.js';
import { ANNIndex, ANNIndexConfig } from '../ann_index.js';

export class InMemoryBackend implements VectorStore {
	private readonly config: InMemoryBackendConfig;
	private readonly collectionName: string;
	private readonly dimension: number;
	private readonly logger: Logger;
	private annIndex: ANNIndex;
	private connected = false;
	private payloads: Map<number, Record<string, any>> = new Map();

	constructor(config: InMemoryBackendConfig) {
		this.config = config;
		this.collectionName = config.collectionName;
		this.dimension = config.dimension;
		this.logger = createLogger();
	}

	async connect(): Promise<void> {
		if (this.connected) {
			this.logger.debug(`${LOG_PREFIXES.MEMORY} Already connected`);
			return;
		}

		// Use defaults for persistence if not provided
		const persistIndex = this.config.annPersistIndex ?? DEFAULTS.PERSISTENCE_ENABLED;
		const indexPath = this.config.annIndexPath ?? DEFAULTS.PERSISTENCE_PATH;

		// Ensure persistence directory exists if persistence is enabled
		if (persistIndex && indexPath) {
			try {
				const fs = await import('fs/promises');
				const path = await import('path');
				await fs.mkdir(indexPath, { recursive: true });
				this.logger.debug(`${LOG_PREFIXES.MEMORY} Created persistence directory: ${indexPath}`);
			} catch (error: any) {
				this.logger.warn(`${LOG_PREFIXES.MEMORY} Failed to create persistence directory: ${error.message}`);
			}
		}

		const annConfig: ANNIndexConfig = {
			algorithm: this.config.annAlgorithm || 'flat',
			dimension: this.dimension,
			maxVectors: this.config.maxVectors || 10000,
			minDatasetSize: this.config.annMinDatasetSize || 100,
			persistIndex,
			indexPath,
		};

		this.annIndex = new ANNIndex(annConfig);
		await this.annIndex.initialize();

		// Load payloads if persistence is enabled
		if (persistIndex && indexPath) {
			await this.loadPayloads();
		}

		this.connected = true;
		this.logger.debug(`${LOG_PREFIXES.MEMORY} Connected (in-memory)`);
	}

	async disconnect(): Promise<void> {
		if (!this.connected) {
			this.logger.debug(`${LOG_PREFIXES.MEMORY} Already disconnected`);
			return;
		}
		// Save payloads before disconnecting
		const persistIndex = this.config.annPersistIndex ?? DEFAULTS.PERSISTENCE_ENABLED;
		const indexPath = this.config.annIndexPath ?? DEFAULTS.PERSISTENCE_PATH;
		if (persistIndex && indexPath) {
			await this.savePayloads();
		}

		await this.annIndex.disconnect();
		this.connected = false;
		this.logger.info(`${LOG_PREFIXES.MEMORY} Disconnected and saved data`);
	}

	isConnected(): boolean {
		return this.connected;
	}

	async insert(vectors: number[][], ids: number[], payloads: Record<string, any>[]): Promise<void> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'insert');
		}
		await this.annIndex.add(vectors, ids);
		for (let i = 0; i < ids.length; i++) {
			this.payloads.set(ids[i]!, payloads[i]!);
		}
		const persistIndex = this.config.annPersistIndex ?? DEFAULTS.PERSISTENCE_ENABLED;
		if (persistIndex) {
			await this.savePayloads();
		}
	}

	async search(
		query: number[],
		limit: number = DEFAULTS.SEARCH_LIMIT,
		filters?: SearchFilters
	): Promise<VectorStoreResult[]> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'search');
		}

		const filterFn = filters ? (id: number) => this.matchesFilters(id, filters) : undefined;
		const annResults = await this.annIndex.search(query, limit, filterFn);

		return annResults.map(result => ({
			id: result.id,
			score: result.score,
			payload: this.payloads.get(result.id) || {},
			vector: [], // Not returning vector as it's not stored in the payload
		}));
	}

	async get(vectorId: number): Promise<VectorStoreResult | null> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'get');
		}
		const payload = this.payloads.get(vectorId);
		if (!payload) {
			return null;
		}
		return {
			id: vectorId,
			payload,
			score: 1,
			vector: [],
		};
	}

	async update(vectorId: number, vector: number[], payload: Record<string, any>): Promise<void> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'update');
		}
		await this.annIndex.remove([vectorId]);
		await this.annIndex.add([vector], [vectorId]);
		this.payloads.set(vectorId, payload);
		const persistIndex = this.config.annPersistIndex ?? DEFAULTS.PERSISTENCE_ENABLED;
		if (persistIndex) {
			await this.savePayloads();
		}
	}

	async delete(vectorId: number): Promise<void> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'delete');
		}
		await this.annIndex.remove([vectorId]);
		this.payloads.delete(vectorId);
		const persistIndex = this.config.annPersistIndex ?? DEFAULTS.PERSISTENCE_ENABLED;
		if (persistIndex) {
			await this.savePayloads();
		}
	}

	async deleteCollection(): Promise<void> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'deleteCollection');
		}
		await this.annIndex.clear();
		this.payloads.clear();
		const persistIndex = this.config.annPersistIndex ?? DEFAULTS.PERSISTENCE_ENABLED;
		if (persistIndex) {
			await this.savePayloads();
		}
	}

	async list(filters?: SearchFilters, limit: number = 100): Promise<[VectorStoreResult[], number]> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'list');
		}

		const results: VectorStoreResult[] = [];
		let count = 0;

		for (const [id, payload] of this.payloads.entries()) {
			if (this.matchesFilters(id, filters || {})) {
				count++;
				if (results.length < limit) {
					results.push({
						id,
						payload,
						score: 1.0,
						vector: [],
					});
				}
			}
		}

		return [results, count];
	}

	getBackendType(): string {
		return 'in-memory';
	}

	getDimension(): number {
		return this.dimension;
	}

	getCollectionName(): string {
		return this.collectionName;
	}

	private matchesFilters(id: number, filters: SearchFilters): boolean {
		const payload = this.payloads.get(id);
		if (!payload) {
			return false;
		}
		for (const key in filters) {
			if (payload[key] !== filters[key]) {
				return false;
			}
		}
		return true;
	}

	private async savePayloads(): Promise<void> {
		const indexPath = this.config.annIndexPath ?? DEFAULTS.PERSISTENCE_PATH;
		if (!indexPath) {
			this.logger.debug(`${LOG_PREFIXES.MEMORY} No persistence path configured, skipping payload save`);
			return;
		}

		try {
			const fs = await import('fs/promises');
			const path = await import('path');
			
			// Ensure directory exists
			await fs.mkdir(indexPath, { recursive: true });
			
			const metadataFile = path.join(indexPath, 'payloads.json');
			const metadata = JSON.stringify(Array.from(this.payloads.entries()), null, 2);
			await fs.writeFile(metadataFile, metadata);
			
			this.logger.debug(`${LOG_PREFIXES.MEMORY} Saved ${this.payloads.size} payloads to ${metadataFile}`);
		} catch (error: any) {
			this.logger.error(`${LOG_PREFIXES.MEMORY} Failed to save payloads: ${error.message}`);
			// Don't throw error to avoid breaking operations
		}
	}

	private async loadPayloads(): Promise<void> {
		const indexPath = this.config.annIndexPath ?? DEFAULTS.PERSISTENCE_PATH;
		if (!indexPath) {
			this.logger.debug(`${LOG_PREFIXES.MEMORY} No persistence path configured, skipping payload load`);
			return;
		}

		try {
			const fs = await import('fs/promises');
			const path = await import('path');
			const metadataFile = path.join(indexPath, 'payloads.json');
			
			// Check if file exists
			try {
				await fs.access(metadataFile);
			} catch {
				this.logger.debug(`${LOG_PREFIXES.MEMORY} No existing payloads file found at ${metadataFile}`);
				this.payloads = new Map();
				return;
			}
			
			const metadata = await fs.readFile(metadataFile, 'utf-8');
			this.payloads = new Map(JSON.parse(metadata));
			
			this.logger.info(`${LOG_PREFIXES.MEMORY} Loaded ${this.payloads.size} payloads from ${metadataFile}`);
		} catch (error: any) {
			this.logger.warn(`${LOG_PREFIXES.MEMORY} Could not load payloads file: ${error.message}. Starting with an empty payload map.`);
			this.payloads = new Map();
		}
	}
}
