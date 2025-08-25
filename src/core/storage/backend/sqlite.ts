/**
 * SQLite Backend Implementation
 *
 * Provides persistent storage using SQLite database with better-sqlite3.
 * Implements the DatabaseBackend interface with file-based storage.
 *
 * @module storage/backend/sqlite
 */

import Database from 'better-sqlite3';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import type { DatabaseBackend } from './database-backend.js';
import type { SqliteBackendConfig } from '../config.js';
import { StorageError, StorageConnectionError } from './types.js';
import { BACKEND_TYPES, ERROR_MESSAGES } from '../constants.js';
import { Logger, createLogger } from '../../logger/index.js';

/**
 * SQLite Database Backend
 *
 * Provides persistent storage using SQLite database.
 * Supports key-value operations and list operations for collections.
 *
 * Features:
 * - File-based storage with automatic directory creation
 * - Prepared statements for performance
 * - Transaction support for batch operations
 * - JSON serialization for complex objects
 * - Efficient list operations with indexes
 *
 * @example
 * ```typescript
 * const sqlite = new SqliteBackend({
 *   type: 'sqlite',
 *   path: './data',
 *   database: 'myapp.db'
 * });
 *
 * await sqlite.connect();
 * await sqlite.set('user:123', { name: 'John', email: 'john@example.com' });
 * ```
 */
export class SqliteBackend implements DatabaseBackend {
	private readonly logger: Logger;
	private connected = false;
	private db: Database.Database | undefined;
	private dbPath: string;

	// Prepared statements for performance
	private statements: {
		get?: Database.Statement;
		set?: Database.Statement;
		delete?: Database.Statement;
		list?: Database.Statement;
		getRange?: Database.Statement;
		listCount?: Database.Statement;
	} = {};

	constructor(private config: SqliteBackendConfig) {
		this.logger = createLogger({ level: process.env.LOG_LEVEL || 'info' });

		// Construct database path
		const dbPath = config.path || './data';
		const dbName = config.database || 'cipher.db';
		this.dbPath = join(dbPath, dbName);

		this.logger.debug('SQLite backend initialized', {
			path: this.dbPath,
			config: { ...config, path: dbPath, database: dbName },
		});
	}

	async connect(): Promise<void> {
		if (this.connected) {
			return;
		}

		try {
			// Ensure directory exists
			const dir = dirname(this.dbPath);
			this.logger.debug('Ensuring database directory exists', { dir, dbPath: this.dbPath });
			if (!existsSync(dir)) {
				await mkdir(dir, { recursive: true });
				this.logger.debug('Created database directory', { dir });
			}

			// Open database with enhanced error handling
			this.logger.debug('Opening SQLite database', { path: this.dbPath });
			this.db = new Database(this.dbPath);

			if (!this.db) {
				throw new Error('Failed to create SQLite database connection - database instance is null');
			}

			// Test basic database functionality
			this.logger.debug('Testing database connection');
			this.db.pragma('journal_mode = WAL'); // Enable WAL mode for better performance
			this.db.pragma('synchronous = NORMAL'); // Balanced performance/durability
			this.db.pragma('foreign_keys = ON'); // Enable foreign keys

			// Create tables
			this.logger.debug('Creating database tables');
			this.createTables();

			// Prepare statements
			this.logger.debug('Preparing SQL statements');
			this.prepareStatements();

			this.connected = true;
			this.logger.info('SQLite backend connected successfully', {
				path: this.dbPath,
				dbSize: this.getDbInfo(),
			});

		} catch (error) {
			const errorDetails = {
				path: this.dbPath,
				directory: dirname(this.dbPath),
				directoryExists: existsSync(dirname(this.dbPath)),
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				nodeVersion: process.version,
				platform: process.platform,
				arch: process.arch,
			};
			console.log('Failed to connect to SQLite database', errorDetails);
			// this.logger.error('Failed to connect to SQLite database', errorDetails);

			throw new StorageConnectionError(
				`Failed to connect to SQLite database: ${error instanceof Error ? error.message : String(error)}`,
				BACKEND_TYPES.SQLITE,
				error as Error
			);
		}
	}

	async disconnect(): Promise<void> {
		if (!this.connected || !this.db) {
			return;
		}

		try {
			// Close prepared statements
			Object.values(this.statements).forEach(_stmt => {
				try {
					// better-sqlite3 statements don't need explicit finalization
					// They are automatically cleaned up when the database is closed
				} catch (error) {
					this.logger.warn('Error finalizing statement', { error });
				}
			});
			this.statements = {};

			// Close database
			this.db.close();
			this.db = undefined;
			this.connected = false;

			this.logger.info('SQLite backend disconnected');
		} catch (error) {
			this.logger.error('Error disconnecting from SQLite database', {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	isConnected(): boolean {
		return this.connected;
	}

	getBackendType(): string {
		return BACKEND_TYPES.SQLITE;
	}

	// DatabaseBackend implementation

	async get<T>(key: string): Promise<T | undefined> {
		this.checkConnection();

		try {
			const row = this.statements.get!.get(key) as { value: string } | undefined;
			if (!row) {
				return undefined;
			}

			return JSON.parse(row.value) as T;
		} catch (error) {
			this.logger.error('Error getting value from SQLite', {
				key,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new StorageError('Failed to get value from SQLite', 'get', error as Error);
		}
	}

	async set<T>(key: string, value: T): Promise<void> {
		this.checkConnection();

		try {
			const serialized = JSON.stringify(value);
			const now = Date.now();
			this.statements.set!.run(key, serialized, now, now);
		} catch (error) {
			this.logger.error('Error setting value in SQLite', {
				key,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new StorageError('Failed to set value in SQLite', 'set', error as Error);
		}
	}

	async delete(key: string): Promise<void> {
		this.checkConnection();

		try {
			// Delete from both key-value store and lists
			const transaction = this.db!.transaction(() => {
				this.statements.delete!.run(key);
				// Also delete from lists table if it exists as a list
				this.db!.prepare('DELETE FROM lists WHERE key = ?').run(key);
			});

			transaction();
		} catch (error) {
			this.logger.error('Error deleting value from SQLite', {
				key,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new StorageError('Failed to delete value from SQLite', 'delete', error as Error);
		}
	}

	async list(prefix: string): Promise<string[]> {
		this.checkConnection();

		try {
			const rows = this.statements.list!.all(prefix + '%') as { key: string }[];
			return rows.map(row => row.key);
		} catch (error) {
			this.logger.error('Error listing keys from SQLite', {
				prefix,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new StorageError('Failed to list keys from SQLite', 'list', error as Error);
		}
	}

	async append<T>(key: string, item: T): Promise<void> {
		this.checkConnection();

		try {
			const serialized = JSON.stringify(item);
			const now = Date.now();

			// Get current max position for this key
			const maxPosResult = this.db!.prepare(
				'SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM lists WHERE key = ?'
			).get(key) as { next_pos: number };
			const nextPosition = maxPosResult.next_pos;

			// Insert the new item
			this.db!.prepare(
				'INSERT INTO lists (key, value, position, created_at) VALUES (?, ?, ?, ?)'
			).run(key, serialized, nextPosition, now);
		} catch (error) {
			this.logger.error('Error appending to list in SQLite', {
				key,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new StorageError('Failed to append to list in SQLite', 'append', error as Error);
		}
	}

	async getRange<T>(key: string, start: number, count: number): Promise<T[]> {
		this.checkConnection();

		try {
			const rows = this.statements.getRange!.all(key, count, start) as { value: string }[];
			return rows.map(row => JSON.parse(row.value) as T);
		} catch (error) {
			this.logger.error('Error getting range from SQLite', {
				key,
				start,
				count,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new StorageError('Failed to get range from SQLite', 'getRange', error as Error);
		}
	}

	// Private helper methods

	private checkConnection(): void {
		if (!this.connected || !this.db) {
			throw new StorageError(ERROR_MESSAGES.NOT_CONNECTED, 'operation');
		}
	}

	private createTables(): void {
		if (!this.db) {
			throw new StorageError('Database not initialized', 'createTables');
		}

		// Key-value store table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS store (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`);

		// Lists table for list operations
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS lists (
				key TEXT NOT NULL,
				value TEXT NOT NULL,
				position INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				PRIMARY KEY (key, position)
			)
		`);

		// List metadata table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS list_metadata (
				key TEXT PRIMARY KEY,
				count INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`);

		// Create indexes for performance
		this.db.exec('CREATE INDEX IF NOT EXISTS idx_store_updated_at ON store(updated_at)');
		this.db.exec('CREATE INDEX IF NOT EXISTS idx_lists_key ON lists(key)');
		this.db.exec('CREATE INDEX IF NOT EXISTS idx_lists_created_at ON lists(created_at)');

		this.logger.debug('SQLite tables and indexes created');
	}

	private prepareStatements(): void {
		if (!this.db) {
			throw new StorageError('Database not initialized', 'prepareStatements');
		}

		this.statements = {
			get: this.db.prepare('SELECT value FROM store WHERE key = ?'),
			set: this.db.prepare(`
				INSERT OR REPLACE INTO store (key, value, created_at, updated_at)
				VALUES (?, ?, ?, ?)
			`),
			delete: this.db.prepare('DELETE FROM store WHERE key = ?'),
			list: this.db.prepare('SELECT key FROM store WHERE key LIKE ? ORDER BY key'),

			// Range query for lists
			getRange: this.db.prepare(`
				SELECT value FROM lists 
				WHERE key = ? 
				ORDER BY position 
				LIMIT ? OFFSET ?
			`),
			listCount: this.db.prepare('SELECT COUNT(*) as count FROM lists WHERE key = ?'),
		};

		this.logger.debug('SQLite prepared statements created');
	}

	/**
	 * Get database file size information
	 */
	getDbInfo(): { path: string; size?: number; pageCount?: number; pageSize?: number } {
		const info: any = { path: this.dbPath };

		if (this.connected && this.db) {
			try {
				const pragmaResult = this.db.pragma('page_count');
				const pageCount = Array.isArray(pragmaResult) ? pragmaResult[0] : pragmaResult;
				const numPageCount = typeof pageCount === 'number' ? pageCount : Number(pageCount);
				if (!isNaN(numPageCount)) {
					info.pageCount = numPageCount;
				}

				const pageSizeResult = this.db.pragma('page_size');
				const pageSize = Array.isArray(pageSizeResult) ? pageSizeResult[0] : pageSizeResult;
				const numPageSize = typeof pageSize === 'number' ? pageSize : Number(pageSize);
				if (!isNaN(numPageSize)) {
					info.pageSize = numPageSize;
				}

				if (info.pageCount && info.pageSize) {
					info.size = info.pageCount * info.pageSize;
				}
			} catch (error) {
				this.logger.warn('Error getting database info', { error });
			}
		}

		return info;
	}

	/**
	 * Run database maintenance operations
	 */
	async maintenance(): Promise<void> {
		this.checkConnection();

		try {
			// Analyze tables for query optimization
			this.db!.exec('ANALYZE');

			// Vacuum to reclaim space (if needed)
			const freeListResult = this.db!.pragma('freelist_count');
			const freePages = Array.isArray(freeListResult) ? freeListResult[0] : freeListResult;
			const freePageCount = typeof freePages === 'number' ? freePages : Number(freePages);

			if (freePageCount > 100) {
				this.db!.exec('VACUUM');
				this.logger.info('Database vacuumed', { freePages: freePageCount });
			}

			this.logger.debug('Database maintenance completed');
		} catch (error) {
			this.logger.error('Error during database maintenance', {
				error: error instanceof Error ? error.message : String(error),
			});
			throw new StorageError('Database maintenance failed', 'maintenance', error as Error);
		}
	}
}
