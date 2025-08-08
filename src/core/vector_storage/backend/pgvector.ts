/**
 * PgVector Backend
 *
 * Implementation of the VectorStore interface for pgvector, a PostgreSQL extension
 * for vector similarity search.
 *
 * Features:
 * - Stores vectors in a PostgreSQL database
 * - Utilizes pgvector for similarity search
 * - Supports filtering and persistent storage
 *
 * @module vector_storage/backend/pgvector
 */

// Recommended: PostgreSQL 14+ with pgvector >= 0.5.0 for HNSW or IVFFLAT indexing support

import { Pool, types } from 'pg';
import type { TypeId } from 'pg-types';
import type { VectorStore } from './vector-store.js';
import type {
	SearchFilters,
	VectorStoreResult,
	BackendConfig,
	PgVectorBackendConfig,
} from './types.js';
import { VectorStoreError, VectorStoreConnectionError, VectorDimensionError } from './types.js';
import { Logger, createLogger } from '../../logger/index.js';
import { LOG_PREFIXES, DEFAULTS, ERROR_MESSAGES, DISTANCE_METRICS } from '../constants.js';

// Define the OID for the vector type. This may need to be adjusted based on the
// specific installation of pgvector. The 'text' OID for vector is 16405.
const VECTOR_OID = 16405;

// Custom type parser for pgvector
const parseVector = (value: string): number[] => {
	if (value.startsWith('[') && value.endsWith(']')) {
		return value
			.substring(1, value.length - 1)
			.split(',')
			.map(parseFloat);
	}
	return [];
};

// Register the custom type parser for the vector type
types.setTypeParser(VECTOR_OID as TypeId, parseVector);

/**
 * PgVectorBackend Class
 *
 * Implements the VectorStore interface for pgvector.
 */
export class PgVectorBackend implements VectorStore {
	private pool: Pool;
	private readonly config: PgVectorBackendConfig;
	private readonly collectionName: string;
	private readonly dimension: number;
	private readonly logger: Logger;
	private connected = false;
	private vectorOid: number | undefined;

	constructor(config: BackendConfig) {
		if (config.type !== 'pgvector') {
			throw new VectorStoreError('Invalid config type for PgVectorBackend', 'initialization');
		}
		this.config = config;
		this.collectionName = config.collectionName;
		this.dimension = config.dimension;
		this.logger = createLogger({
			level: process.env.LOG_LEVEL || 'info',
		});

		this.pool = new Pool({
			connectionString: this.config.url,
			max: this.config.poolSize, // Configurable pool size for concurrent access
		});

		this.logger.debug(`${LOG_PREFIXES.PGVECTOR} Initialized`, {
			collection: this.collectionName,
			dimension: this.dimension,
		});
	}

	// @override
	async connect(): Promise<void> {
		if (this.connected) {
			this.logger.debug(`${LOG_PREFIXES.PGVECTOR} Already connected`);
			return;
		}

		this.logger.info(`${LOG_PREFIXES.PGVECTOR} Connecting to PostgreSQL`);

		try {
			const client = await this.pool.connect();
			try {
				await client.query('CREATE EXTENSION IF NOT EXISTS vector');

				// Dynamically get vector OID
				const { rows } = await client.query("SELECT oid FROM pg_type WHERE typname = 'vector'");
				this.vectorOid = rows[0]?.oid;
				if (this.vectorOid) types.setTypeParser(this.vectorOid, parseVector);

				// Dedicated filter column example: category TEXT
				const tableExists = await client.query(
					`SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_name = $1
          )`,
					[this.collectionName]
				);

				if (!tableExists.rows[0].exists) {
					this.logger.info(`${LOG_PREFIXES.PGVECTOR} Creating table ${this.collectionName}`);
					await client.query(
						`CREATE TABLE "${this.collectionName}" (
              id BIGSERIAL PRIMARY KEY,
              vector vector(${this.dimension}),
              payload JSONB
            )`
					);

					// Configurable index type/metric
					const indexType = this.config.indexType || 'ivfflat';
					const indexMetric = this.config.indexMetric || 'vector_l2_ops';
					await client.query(
						`CREATE INDEX IF NOT EXISTS ${this.collectionName}_vector_idx
             ON "${this.collectionName}"
             USING ${indexType} (vector ${indexMetric})
             WITH (lists = 100)`
					);
				}
				// Create indexes on JSONB subfields for common payload fields
				const payloadFields = ['type', 'category', 'sessionId', 'traceId', 'timestamp'];
				for (const field of payloadFields) {
					await client.query(
						`CREATE INDEX IF NOT EXISTS ${this.collectionName}_payload_${field}_idx ON "${this.collectionName}" ((payload->>'${field}'))`
					);
				}
				await client.query(
					`CREATE INDEX IF NOT EXISTS ${this.collectionName}_tags_gin_idx ON "${this.collectionName}" USING GIN ((payload->'tags'));`
				);
			} finally {
				client.release();
			}
			this.connected = true;
			this.logger.info(`${LOG_PREFIXES.PGVECTOR} Successfully connected`);
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.PGVECTOR} Connection failed: ${error}`);
			throw new VectorStoreConnectionError(
				ERROR_MESSAGES.CONNECTION_FAILED,
				'pgvector',
				error as Error
			);
		}
	}

	// @override
	async disconnect(): Promise<void> {
		if (!this.connected) {
			this.logger.debug(`${LOG_PREFIXES.PGVECTOR} Already disconnected`);
			return;
		}

		this.logger.info(`${LOG_PREFIXES.PGVECTOR} Disconnecting from PostgreSQL`);
		await this.pool.end();
		this.connected = false;
		this.logger.info(`${LOG_PREFIXES.PGVECTOR} Successfully disconnected`);
	}

	// @override
	isConnected(): boolean {
		return this.connected;
	}

	// @override
	getBackendType(): string {
		return 'pgvector';
	}

	// @override
	getDimension(): number {
		return this.dimension;
	}

	// @override
	getCollectionName(): string {
		return this.collectionName;
	}

	// @override
	async insert(vectors: number[][], ids: number[], payloads: Record<string, any>[]): Promise<void> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'insert');
		}

		// For large batches, recommend COPY (not implemented here for brevity)
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');

			// Build a single multi-row INSERT with placeholder parameters
			const values: any[] = [];
			const placeholders: string[] = [];

			for (let i = 0; i < vectors.length; i++) {
				const vector = vectors[i];
				const payload = payloads[i];
				this.validateDimension(vector, 'insert');
				values.push(ids[i], `[${vector.join(',')}]`, payload);
				placeholders.push(`($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`);
			}

			await client.query(
				`INSERT INTO ${this.collectionName} (id, vector, payload) VALUES ${placeholders.join(',')}`,
				values
			);

			await client.query('COMMIT');
		} catch (error) {
			await client.query('ROLLBACK');
			this.logger.error(`${LOG_PREFIXES.PGVECTOR} Insert failed`, { error });
			if (error instanceof VectorDimensionError) {
				throw error; // Re-throw dimension errors
			}
			throw new VectorStoreError('Failed to insert vectors', 'insert', error as Error);
		} finally {
			client.release();
		}
	}

	// @override
	async search(
		query: number[],
		limit: number = DEFAULTS.SEARCH_LIMIT,
		filters?: SearchFilters
	): Promise<VectorStoreResult[]> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'search');
		}
		this.validateDimension(query, 'search');
		// Configurable distance metric
		const metricOp = this.resolveDistanceOp(this.config.distance || 'Cosine');

		const filterClauses = filters ? this.buildFilterClauses(filters) : '';

		const queryString = `
      SELECT id, payload, vector ${metricOp} $1 AS score
      FROM ${this.collectionName}
      ${filterClauses}
      ORDER BY score
      LIMIT $2
    `;
		const queryParams = [`[${query.join(',')}]`, limit];

		try {
			const result = await this.pool.query(queryString, queryParams);
			return result.rows.map(row => ({
				id: parseInt(row.id, 10),
				score: row.score,
				payload: row.payload,
			}));
		} catch (error) {
			this.logger.error(`${LOG_PREFIXES.PGVECTOR} Search failed`, { error });
			throw new VectorStoreError(ERROR_MESSAGES.SEARCH_FAILED, 'search', error as Error);
		}
	}

	// @override
	async get(vectorId: number): Promise<VectorStoreResult | null> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'get');
		}

		const result = await this.pool.query(
			`SELECT id, vector, payload FROM ${this.collectionName} WHERE id = $1`,
			[vectorId]
		);
		if (result.rows.length === 0) {
			return null;
		}
		const row = result.rows[0];
		return {
			id: parseInt(row.id, 10),
			vector: row.vector,
			payload: row.payload,
			score: 1.0,
		};
	}

	// @override
	async update(vectorId: number, vector: number[], payload: Record<string, any>): Promise<void> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'update');
		}
		this.validateDimension(vector, 'update');
		await this.pool.query(
			`UPDATE ${this.collectionName} SET vector = $1, payload = $2 WHERE id = $3`,
			[`[${vector.join(',')}]`, payload, vectorId]
		);
	}

	// @override
	async delete(vectorId: number): Promise<void> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'delete');
		}
		await this.pool.query(`DELETE FROM ${this.collectionName} WHERE id = $1`, [vectorId]);
	}

	// @override
	async deleteCollection(): Promise<void> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'deleteCollection');
		}
		await this.pool.query(`DROP TABLE IF EXISTS ${this.collectionName}`);
	}

	// @override
	async list(filters?: SearchFilters, limit: number = 100): Promise<[VectorStoreResult[], number]> {
		if (!this.connected) {
			throw new VectorStoreError(ERROR_MESSAGES.NOT_CONNECTED, 'list');
		}
		let filterClauses = '';
		if (filters && filters.category) {
			filterClauses = `WHERE category = '${filters.category}'`;
		} else if (filters) {
			filterClauses = this.buildFilterClauses(filters);
		}
		const results = await this.pool.query(
			`SELECT id, vector, payload FROM ${this.collectionName} ${filterClauses} LIMIT ${limit}`
		);
		const countResult = await this.pool.query(
			`SELECT COUNT(*) FROM ${this.collectionName} ${filterClauses}`
		);

		const formattedResults = results.rows.map(row => ({
			id: parseInt(row.id, 10),
			vector: row.vector,
			payload: row.payload,
			score: 1.0,
		}));

		return [formattedResults, parseInt(countResult.rows[0].count, 10)];
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

	private resolveDistanceOp(distance: string): string {
		switch (distance) {
			case DISTANCE_METRICS.EUCLIDEAN:
				return '<->';
			case DISTANCE_METRICS.COSINE:
				return '<=>';
			case DISTANCE_METRICS.DOT_PRODUCT:
				return '<#>';
			case DISTANCE_METRICS.MANHATTAN:
				return '<+>';
			default:
				throw new Error(`Unknown distance metric: ${distance}`);
		}
	}

	private buildFilterClauses(filters: SearchFilters): string {
		// NOTE: For optimal performance, use dedicated columns for frequent filters.
		const conditions = Object.entries(filters).map(([key, value]) => {
			if (typeof value === 'object' && value !== null) {
				if ('gte' in value) return `(payload->>'${key}')::numeric >= ${value.gte}`;
				if ('gt' in value) return `(payload->>'${key}')::numeric > ${value.gt}`;
				if ('lte' in value) return `(payload->>'${key}')::numeric <= ${value.lte}`;
				if ('lt' in value) return `(payload->>'${key}')::numeric < ${value.lt}`;
				// TODO: do we need to support any for a scalar field?
				//if ('any' in value) return `payload->>'${key}' = ANY(ARRAY[${(value.any as any[]).map(v => `'${v}'`).join(',')}])`;
				if ('any' in value)
					return `payload->'${key}' @> '[${(value.any as any[]).map(v => `"${v}"`).join(',')}]'::jsonb`;
			}
			return `payload->>'${key}' = '${value}'`;
		});
		return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
	}
}
