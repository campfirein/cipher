/**
 * In-Memory Backend Tests
 *
 * Tests for the in-memory storage backend implementation.
 * Verifies both CacheBackend and DatabaseBackend functionality.
 */

/* eslint-env vitest */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryBackend } from '../in-memory.js';
import { StorageError } from '../types.js';
import { BACKEND_TYPES } from '../../constants.js';

describe('InMemoryBackend', () => {
	let backend: InMemoryBackend;

	beforeEach(() => {
		backend = new InMemoryBackend();
	});

	afterEach(async () => {
		if (backend.isConnected()) {
			await backend.disconnect();
		}
	});

	describe('Connection Management', () => {
		it('should connect successfully', async () => {
			expect(backend.isConnected()).toBe(false);
			await backend.connect();
			expect(backend.isConnected()).toBe(true);
		});

		it('should handle multiple connect calls', async () => {
			await backend.connect();
			await backend.connect(); // Should not throw
			expect(backend.isConnected()).toBe(true);
		});

		it('should disconnect successfully', async () => {
			await backend.connect();
			await backend.disconnect();
			expect(backend.isConnected()).toBe(false);
		});

		it('should clear data on disconnect', async () => {
			await backend.connect();
			await backend.set('key', 'value');
			await backend.disconnect();
			await backend.connect();
			const value = await backend.get('key');
			expect(value).toBeUndefined();
		});

		it('should return correct backend type', () => {
			expect(backend.getBackendType()).toBe(BACKEND_TYPES.IN_MEMORY);
		});
	});

	describe('Basic Operations', () => {
		beforeEach(async () => {
			await backend.connect();
		});

		it('should set and get values', async () => {
			await backend.set('key1', 'value1');
			await backend.set('key2', { data: 'value2' });

			expect(await backend.get('key1')).toBe('value1');
			expect(await backend.get('key2')).toEqual({ data: 'value2' });
		});

		it('should return undefined for non-existent keys', async () => {
			expect(await backend.get('nonexistent')).toBeUndefined();
		});

		it('should delete values', async () => {
			await backend.set('key', 'value');
			expect(await backend.get('key')).toBe('value');

			await backend.delete('key');
			expect(await backend.get('key')).toBeUndefined();
		});

		it('should throw error when not connected', async () => {
			await backend.disconnect();

			await expect(backend.get('key')).rejects.toThrow(StorageError);
			await expect(backend.set('key', 'value')).rejects.toThrow(StorageError);
			await expect(backend.delete('key')).rejects.toThrow(StorageError);
		});
	});

	describe('TTL Support', () => {
		beforeEach(async () => {
			await backend.connect();
		});

		it('should respect TTL', async () => {
			await backend.set('ttl-key', 'value', 1); // 1 second TTL
			expect(await backend.get('ttl-key')).toBe('value');

			// Wait for expiration
			await new Promise(resolve => setTimeout(resolve, 1100));

			expect(await backend.get('ttl-key')).toBeUndefined();
		});

		it('should store values without TTL indefinitely', async () => {
			await backend.set('no-ttl', 'value');

			// Wait a bit
			await new Promise(resolve => setTimeout(resolve, 100));

			expect(await backend.get('no-ttl')).toBe('value');
		});
	});

	describe('List Operations', () => {
		beforeEach(async () => {
			await backend.connect();
		});

		it('should list keys with prefix', async () => {
			await backend.set('user:1', 'Alice');
			await backend.set('user:2', 'Bob');
			await backend.set('post:1', 'Hello');

			const userKeys = await backend.list('user:');
			expect(userKeys).toHaveLength(2);
			expect(userKeys).toContain('user:1');
			expect(userKeys).toContain('user:2');

			const postKeys = await backend.list('post:');
			expect(postKeys).toHaveLength(1);
			expect(postKeys).toContain('post:1');
		});

		it('should exclude expired keys from list', async () => {
			await backend.set('temp:1', 'value1', 1);
			await backend.set('temp:2', 'value2');

			// Wait for first key to expire
			await new Promise(resolve => setTimeout(resolve, 1100));

			const keys = await backend.list('temp:');
			expect(keys).toHaveLength(1);
			expect(keys).toContain('temp:2');
		});

		it('should append items to lists', async () => {
			await backend.append('log', 'entry1');
			await backend.append('log', 'entry2');
			await backend.append('log', 'entry3');

			const items = await backend.getRange('log', 0, 10);
			expect(items).toEqual(['entry1', 'entry2', 'entry3']);
		});

		it('should get range from lists', async () => {
			for (let i = 0; i < 10; i++) {
				await backend.append('numbers', i);
			}

			expect(await backend.getRange('numbers', 0, 3)).toEqual([0, 1, 2]);
			expect(await backend.getRange('numbers', 5, 3)).toEqual([5, 6, 7]);
			expect(await backend.getRange('numbers', 8, 5)).toEqual([8, 9]);
		});

		it('should handle negative indices in getRange', async () => {
			for (let i = 0; i < 5; i++) {
				await backend.append('items', i);
			}

			// Negative start: -2 means start from 2 positions before the end
			// List is [0, 1, 2, 3, 4], so -2 is index 3
			expect(await backend.getRange('items', -2, 3)).toEqual([3, 4]);

			// More negative index tests
			expect(await backend.getRange('items', -5, 3)).toEqual([0, 1, 2]);
			expect(await backend.getRange('items', -1, 1)).toEqual([4]);
		});

		it('should return empty array for non-existent lists', async () => {
			expect(await backend.getRange('nonexistent', 0, 10)).toEqual([]);
		});
	});

	describe('Data Isolation', () => {
		beforeEach(async () => {
			await backend.connect();
		});

		it('should clone values to prevent reference issues', async () => {
			const obj = { name: 'test', nested: { value: 42 } };
			await backend.set('obj', obj);

			// Modify original
			obj.name = 'modified';
			obj.nested.value = 100;

			// Retrieved value should be unchanged
			const retrieved = await backend.get<typeof obj>('obj');
			expect(retrieved).toEqual({ name: 'test', nested: { value: 42 } });
		});

		it('should clone values in lists', async () => {
			const item = { id: 1, data: 'test' };
			await backend.append('list', item);

			// Modify original
			item.id = 2;
			item.data = 'modified';

			const items = await backend.getRange<typeof item>('list', 0, 1);
			expect(items[0]).toEqual({ id: 1, data: 'test' });
		});
	});

	describe('Statistics and Utilities', () => {
		beforeEach(async () => {
			await backend.connect();
		});

		it('should track statistics', async () => {
			await backend.set('key1', 'value1');
			await backend.set('key2', 'value2');
			await backend.get('key1'); // hit
			await backend.get('nonexistent'); // miss
			await backend.delete('key1');

			const stats = backend.getStats();
			expect(stats.sets).toBe(2);
			expect(stats.hits).toBe(1);
			expect(stats.misses).toBe(1);
			expect(stats.deletes).toBe(1);
		});

		it('should report size correctly', async () => {
			await backend.set('key1', 'value1');
			await backend.set('key2', 'value2');
			await backend.append('list1', 'item');

			const size = backend.getSize();
			expect(size.keys).toBe(2);
			expect(size.lists).toBe(1);
			expect(size.total).toBe(3);
		});

		it('should manually cleanup expired entries', async () => {
			await backend.set('temp1', 'value', 0.1);
			await backend.set('temp2', 'value', 0.1);
			await backend.set('permanent', 'value');

			// Wait for expiration
			await new Promise(resolve => setTimeout(resolve, 150));

			const cleaned = await backend.cleanup();
			expect(cleaned).toBe(2);

			const size = backend.getSize();
			expect(size.keys).toBe(1);
		});
	});

	describe('Error Handling', () => {
		it('should throw on serialization errors', async () => {
			await backend.connect();

			// Create circular reference
			const obj: any = { a: 1 };
			obj.circular = obj;

			await expect(backend.set('circular', obj)).rejects.toThrow(StorageError);
		});
	});
});
