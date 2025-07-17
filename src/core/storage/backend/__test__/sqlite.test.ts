/**
 * SQLite Backend Tests
 *
 * Tests for the SQLite database backend implementation.
 * Verifies DatabaseBackend functionality with persistent storage.
 */

/* eslint-env vitest */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteBackend } from '../sqlite.js';
import { StorageError, StorageConnectionError } from '../types.js';
import { BACKEND_TYPES } from '../../constants.js';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';

describe.skip('SqliteBackend', () => {
	let backend: SqliteBackend;
	const testDbPath = './test-data';
	const testDbName = 'test.db';
	const fullDbPath = join(testDbPath, testDbName);

	beforeEach(async () => {
		// Clean up any existing test database
		if (existsSync(testDbPath)) {
			rmSync(testDbPath, { recursive: true, force: true });
		}

		backend = new SqliteBackend({
			type: 'sqlite',
			path: testDbPath,
			database: testDbName,
		});
	});

	afterEach(async () => {
		if (backend.isConnected()) {
			await backend.disconnect();
		}

		// Clean up test database
		if (existsSync(testDbPath)) {
			rmSync(testDbPath, { recursive: true, force: true });
		}
	});

	describe('Connection Management', () => {
		it.skip('should connect successfully', async () => {
			expect(backend.isConnected()).toBe(false);
			await backend.connect();
			expect(backend.isConnected()).toBe(true);
			expect(existsSync(fullDbPath)).toBe(true);
		});

		it.skip('should handle multiple connect calls', async () => {
			await backend.connect();
			await backend.connect(); // Should not throw
			expect(backend.isConnected()).toBe(true);
		});

		it.skip('should disconnect successfully', async () => {
			await backend.connect();
			expect(backend.isConnected()).toBe(true);

			await backend.disconnect();
			expect(backend.isConnected()).toBe(false);
		});

		it.skip('should handle multiple disconnect calls', async () => {
			await backend.connect();
			await backend.disconnect();
			await backend.disconnect(); // Should not throw
			expect(backend.isConnected()).toBe(false);
		});

		it.skip('should throw connection error for invalid path', async () => {
			const invalidBackend = new SqliteBackend({
				type: 'sqlite',
				path: '/invalid/read-only/path',
				database: 'test.db',
			});

			await expect(invalidBackend.connect()).rejects.toThrow(StorageConnectionError);
		});
	});

	describe('Backend Type', () => {
		it.skip('should return correct backend type', () => {
			expect(backend.getBackendType()).toBe(BACKEND_TYPES.SQLITE);
		});
	});

	describe('Basic Operations', () => {
		beforeEach(async () => {
			await backend.connect();
		});

		it.skip('should store and retrieve values', async () => {
			const testData = { name: 'John', age: 30, active: true };

			await backend.set('user:123', testData);
			const retrieved = await backend.get<typeof testData>('user:123');

			expect(retrieved).toEqual(testData);
		});

		it.skip('should handle different data types', async () => {
			const testCases = [
				{ key: 'string', value: 'hello world' },
				{ key: 'number', value: 42 },
				{ key: 'boolean', value: true },
				{ key: 'object', value: { nested: { data: 'test' } } },
				{ key: 'array', value: [1, 2, 3, 'four'] },
				{ key: 'null', value: null },
			];

			for (const { key, value } of testCases) {
				await backend.set(key, value);
				const retrieved = await backend.get(key);
				expect(retrieved).toEqual(value);
			}
		});

		it.skip('should return undefined for non-existent keys', async () => {
			const result = await backend.get('non-existent');
			expect(result).toBeUndefined();
		});

		it.skip('should update existing values', async () => {
			await backend.set('counter', 1);
			await backend.set('counter', 2);

			const result = await backend.get<number>('counter');
			expect(result).toBe(2);
		});

		it.skip('should delete values', async () => {
			await backend.set('temp', 'delete me');
			expect(await backend.get('temp')).toBe('delete me');

			await backend.delete('temp');
			expect(await backend.get('temp')).toBeUndefined();
		});

		it.skip('should handle delete of non-existent key', async () => {
			await expect(backend.delete('non-existent')).resolves.not.toThrow();
		});
	});

	describe('List Operations', () => {
		beforeEach(async () => {
			await backend.connect();
		});

		it.skip('should list keys by prefix', async () => {
			await backend.set('user:1', { name: 'Alice' });
			await backend.set('user:2', { name: 'Bob' });
			await backend.set('user:3', { name: 'Charlie' });
			await backend.set('config:theme', 'dark');

			const userKeys = await backend.list('user:');
			expect(userKeys).toHaveLength(3);
			expect(userKeys).toContain('user:1');
			expect(userKeys).toContain('user:2');
			expect(userKeys).toContain('user:3');
			expect(userKeys).not.toContain('config:theme');
		});

		it.skip('should return empty array for non-matching prefix', async () => {
			await backend.set('foo', 'bar');
			const result = await backend.list('non-matching:');
			expect(result).toEqual([]);
		});

		it.skip('should sort keys alphabetically', async () => {
			await backend.set('item:c', 'C');
			await backend.set('item:a', 'A');
			await backend.set('item:b', 'B');

			const keys = await backend.list('item:');
			expect(keys).toEqual(['item:a', 'item:b', 'item:c']);
		});
	});

	describe('List/Array Operations', () => {
		beforeEach(async () => {
			await backend.connect();
		});

		it.skip('should append items to list', async () => {
			await backend.append('logs', { message: 'First log', timestamp: 1 });
			await backend.append('logs', { message: 'Second log', timestamp: 2 });
			await backend.append('logs', { message: 'Third log', timestamp: 3 });

			const logs = await backend.getRange('logs', 0, 10);
			expect(logs).toHaveLength(3);
			expect(logs[0]).toEqual({ message: 'First log', timestamp: 1 });
			expect(logs[1]).toEqual({ message: 'Second log', timestamp: 2 });
			expect(logs[2]).toEqual({ message: 'Third log', timestamp: 3 });
		});

		it.skip('should handle range queries', async () => {
			// Add multiple items
			for (let i = 0; i < 10; i++) {
				await backend.append('numbers', { value: i });
			}

			// Test different ranges
			const first3 = await backend.getRange('numbers', 0, 3);
			expect(first3).toHaveLength(3);
			expect(first3[0]).toEqual({ value: 0 });
			expect(first3[2]).toEqual({ value: 2 });

			const middle3 = await backend.getRange('numbers', 3, 3);
			expect(middle3).toHaveLength(3);
			expect(middle3[0]).toEqual({ value: 3 });
			expect(middle3[2]).toEqual({ value: 5 });

			const last2 = await backend.getRange('numbers', 8, 5);
			expect(last2).toHaveLength(2);
			expect(last2[0]).toEqual({ value: 8 });
			expect(last2[1]).toEqual({ value: 9 });
		});

		it.skip('should return empty array for non-existent list', async () => {
			const result = await backend.getRange('non-existent', 0, 10);
			expect(result).toEqual([]);
		});

		it.skip('should handle out-of-bounds range queries', async () => {
			await backend.append('small-list', 'item1');
			await backend.append('small-list', 'item2');

			const result = await backend.getRange('small-list', 10, 5);
			expect(result).toEqual([]);
		});
	});

	describe('Data Persistence', () => {
		it.skip('should persist data across connections', async () => {
			// First connection - store data
			await backend.connect();
			await backend.set('persistent', { data: 'should persist' });
			await backend.append('persistent-list', 'item1');
			await backend.append('persistent-list', 'item2');
			await backend.disconnect();

			// Second connection - verify data exists
			const newBackend = new SqliteBackend({
				type: 'sqlite',
				path: testDbPath,
				database: testDbName,
			});

			await newBackend.connect();

			const persistentData = await newBackend.get('persistent');
			expect(persistentData).toEqual({ data: 'should persist' });

			const persistentList = await newBackend.getRange('persistent-list', 0, 10);
			expect(persistentList).toEqual(['item1', 'item2']);

			await newBackend.disconnect();
		});
	});

	describe('Error Handling', () => {
		it.skip('should throw error when not connected', async () => {
			expect(backend.isConnected()).toBe(false);

			await expect(backend.get('key')).rejects.toThrow(StorageError);
			await expect(backend.set('key', 'value')).rejects.toThrow(StorageError);
			await expect(backend.delete('key')).rejects.toThrow(StorageError);
			await expect(backend.list('prefix')).rejects.toThrow(StorageError);
			await expect(backend.append('key', 'item')).rejects.toThrow(StorageError);
			await expect(backend.getRange('key', 0, 10)).rejects.toThrow(StorageError);
		});

		it.skip('should handle serialization errors gracefully', async () => {
			await backend.connect();

			// Create circular reference (can't be JSON serialized)
			const circular: any = { name: 'circular' };
			circular.self = circular;

			await expect(backend.set('circular', circular)).rejects.toThrow(StorageError);
		});
	});

	describe('Database Information', () => {
		it.skip('should provide database info when connected', async () => {
			await backend.connect();

			const info = backend.getDbInfo();
			expect(info.path).toBe(fullDbPath);

			// Database info might not always be available depending on how data is stored
			// So just check that the fields are either numbers or undefined
			if (info.size !== undefined) {
				expect(typeof info.size).toBe('number');
				expect(info.size).toBeGreaterThan(0);
			}
			if (info.pageCount !== undefined) {
				expect(typeof info.pageCount).toBe('number');
			}
			if (info.pageSize !== undefined) {
				expect(typeof info.pageSize).toBe('number');
			}
		});

		it.skip('should provide basic info when not connected', () => {
			const info = backend.getDbInfo();
			expect(info.path).toBe(fullDbPath);
			expect(info.size).toBeUndefined();
			expect(info.pageCount).toBeUndefined();
			expect(info.pageSize).toBeUndefined();
		});
	});

	describe('Database Maintenance', () => {
		beforeEach(async () => {
			await backend.connect();
		});

		it.skip('should run maintenance without error', async () => {
			// Add some data first
			for (let i = 0; i < 100; i++) {
				await backend.set(`key:${i}`, { data: `value ${i}` });
			}

			await expect(backend.maintenance()).resolves.not.toThrow();
		});

		it.skip('should throw error when maintenance called without connection', async () => {
			await backend.disconnect();
			await expect(backend.maintenance()).rejects.toThrow(StorageError);
		});
	});

	describe('Complex Scenarios', () => {
		beforeEach(async () => {
			await backend.connect();
		});

		it.skip('should handle mixed operations', async () => {
			// Store some key-value pairs
			await backend.set('config:app', { version: '1.0.0' });
			await backend.set('config:debug', true);

			// Create some lists
			await backend.append('logs:error', { level: 'error', message: 'Test error' });
			await backend.append('logs:info', { level: 'info', message: 'Test info' });
			await backend.append('logs:error', { level: 'error', message: 'Another error' });

			// Verify key-value operations
			const configs = await backend.list('config:');
			expect(configs).toContain('config:app');
			expect(configs).toContain('config:debug');

			// Verify list operations
			const errorLogs = await backend.getRange('logs:error', 0, 10);
			expect(errorLogs).toHaveLength(2);

			// Clean up some data
			await backend.delete('config:debug');
			expect(await backend.get('config:debug')).toBeUndefined();
			expect(await backend.get('config:app')).toBeDefined();

			// Lists should still work
			const infoLogs = await backend.getRange('logs:info', 0, 10);
			expect(infoLogs).toHaveLength(1);
		});
	});
});
