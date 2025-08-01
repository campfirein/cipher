import { describe, it, expect } from 'vitest';
import { StorageManager } from '../../../../../storage/manager.js';
import { createDatabaseHistoryProvider } from '../factory.js';
import { DatabaseHistoryProvider } from '../database.js';

describe('createDatabaseHistoryProvider', () => {
	it('should create a DatabaseHistoryProvider instance for in-memory backend', async () => {
		const config = {
			cache: { type: 'in-memory' as const },
			database: { type: 'in-memory' as const },
		};
		const storageManager = new StorageManager(config);
		await storageManager.connect();
		const provider = createDatabaseHistoryProvider(storageManager);
		expect(provider).toBeInstanceOf(DatabaseHistoryProvider);
	});
	it('should create a DatabaseHistoryProvider instance for in-memory backend', async () => {
		const config = {
			cache: { type: 'in-memory' as const },
			database: { type: 'in-memory' as const },
		};
		const storageManager = new StorageManager(config);
		await storageManager.connect();
		const provider = createDatabaseHistoryProvider(storageManager);
		expect(provider).toBeInstanceOf(DatabaseHistoryProvider);
	});

	it('should create a DatabaseHistoryProvider instance for SQLite backend', async () => {
		let hasSqlite = true;
		try {
			require('better-sqlite3');
		} catch (e) {
			hasSqlite = false;
		}
		if (!hasSqlite) {
			console.warn('Skipping SQLite test: better-sqlite3 not installed');
			return;
		}
		const config = {
			cache: { type: 'in-memory' as const },
			database: { type: 'sqlite' as const, path: ':memory:' },
		};
		const storageManager = new StorageManager(config);
		await storageManager.connect();
		const provider = createDatabaseHistoryProvider(storageManager);
		expect(provider).toBeInstanceOf(DatabaseHistoryProvider);
	});

	it('should create a DatabaseHistoryProvider instance for PostgreSQL backend', async () => {
		let hasPg = true;
		try {
			require('pg');
		} catch (e) {
			hasPg = false;
		}
		if (!hasPg) {
			console.warn('Skipping PostgreSQL test: pg not installed');
			return;
		}
		const config = {
			cache: { type: 'in-memory' as const },
			database: {
				type: 'postgres' as const,
				url: 'postgres://testuser:testpass@localhost:5432/testdb',
			},
		};
		const storageManager = new StorageManager(config);
		try {
			await storageManager.connect();
		} catch (err) {
			console.warn('Skipping PostgreSQL test: could not connect to database', err);
			return;
		}
		const provider = createDatabaseHistoryProvider(storageManager);
		expect(provider).toBeInstanceOf(DatabaseHistoryProvider);
	}, 20000);

	it('should throw for misconfigured backend', async () => {
		const config = { cache: { type: 'in-memory' as const }, database: { type: 'unknown' as any } };
		// StorageManager constructor should throw synchronously for invalid config
		expect(() => new StorageManager(config)).toThrow(/Invalid backend type/);
	});
	it('should throw for misconfigured backend', async () => {
		const config = { cache: { type: 'in-memory' as const }, database: { type: 'unknown' as any } };
		// StorageManager constructor should throw synchronously for invalid config
		expect(() => new StorageManager(config)).toThrow(/Invalid backend type/);
	});
});
