/**
 * Memory History Service Tests
 *
 * Tests for the memory history storage service implementation.
 * Verifies recording, querying, and analytics functionality.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryHistoryStorageService } from '../service.js';
import { createMemoryHistoryEntry } from '../index.js';
import type { MemoryHistoryEntry, HistoryFilters } from '../types.js';

// Mock the logger to reduce noise in tests
vi.mock('../../../logger/index.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

// Mock the env module
vi.mock('../../../env.js', () => ({
	env: {
		CIPHER_LOG_LEVEL: 'info',
		STORAGE_CACHE_TYPE: 'in-memory',
		STORAGE_DATABASE_TYPE: 'in-memory',
	},
}));

/* eslint-env vitest */
describe('MemoryHistoryStorageService', () => {
	let service: MemoryHistoryStorageService;

	beforeEach(() => {
		service = new MemoryHistoryStorageService();
	});

	afterEach(async () => {
		if (service.isConnected()) {
			await service.disconnect();
		}
	});

	describe('Connection Management', () => {
		it('should start disconnected', () => {
			expect(service.isConnected()).toBe(false);
		});

		it('should connect successfully', async () => {
			await service.connect();
			expect(service.isConnected()).toBe(true);
		});

		it('should handle multiple connect calls', async () => {
			await service.connect();
			await service.connect(); // Should not throw
			expect(service.isConnected()).toBe(true);
		});

		it('should disconnect successfully', async () => {
			await service.connect();
			await service.disconnect();
			expect(service.isConnected()).toBe(false);
		});

		it('should handle disconnect when not connected', async () => {
			await expect(service.disconnect()).resolves.not.toThrow();
		});
	});

	describe('Operation Recording', () => {
		beforeEach(async () => {
			await service.connect();
		});

		it('should record a memory operation successfully', async () => {
			const entry = createMemoryHistoryEntry({
				projectId: 'test-project',
				memoryId: 'mem-123',
				name: 'Test operation',
				operation: 'ADD',
				tags: ['test', 'memory'],
				success: true,
				metadata: { source: 'test' },
			});

			await expect(service.recordOperation(entry)).resolves.not.toThrow();
		});

		it('should throw error when not connected', async () => {
			await service.disconnect();

			const entry = createMemoryHistoryEntry({
				projectId: 'test-project',
				memoryId: 'mem-123',
				name: 'Test operation',
				operation: 'ADD',
				tags: ['test'],
				success: true,
				metadata: {},
			});

			await expect(service.recordOperation(entry)).rejects.toThrow('not connected');
		});

		it('should validate required fields', async () => {
			const invalidEntry = {
				projectId: 'test-project',
				// Missing required fields
			} as any;

			await expect(service.recordOperation(invalidEntry)).rejects.toThrow();
		});

		it('should validate operation type', async () => {
			const entry = createMemoryHistoryEntry({
				projectId: 'test-project',
				memoryId: 'mem-123',
				name: 'Test operation',
				operation: 'INVALID' as any,
				tags: ['test'],
				success: true,
				metadata: {},
			});

			await expect(service.recordOperation(entry)).rejects.toThrow('Invalid operation type');
		});

		it('should validate timestamp format', async () => {
			const entry = createMemoryHistoryEntry({
				projectId: 'test-project',
				memoryId: 'mem-123',
				name: 'Test operation',
				operation: 'ADD',
				tags: ['test'],
				success: true,
				metadata: {},
				timestamp: 'invalid-timestamp',
			});

			await expect(service.recordOperation(entry)).rejects.toThrow('Invalid timestamp format');
		});
	});

	describe('History Retrieval', () => {
		let testEntries: MemoryHistoryEntry[];

		beforeEach(async () => {
			await service.connect();

			// Create test entries
			testEntries = [
				createMemoryHistoryEntry({
					projectId: 'project-1',
					memoryId: 'mem-1',
					name: 'Add React knowledge',
					operation: 'ADD',
					tags: ['react', 'javascript'],
					userId: 'user-1',
					success: true,
					metadata: { source: 'cli' },
					sessionId: 'session-1',
				}),
				createMemoryHistoryEntry({
					projectId: 'project-1',
					memoryId: 'mem-2',
					name: 'Update Python code',
					operation: 'UPDATE',
					tags: ['python', 'code'],
					userId: 'user-2',
					success: false,
					error: 'Validation failed',
					metadata: { source: 'api' },
					sessionId: 'session-2',
				}),
				createMemoryHistoryEntry({
					projectId: 'project-2',
					memoryId: 'mem-3',
					name: 'Search for patterns',
					operation: 'SEARCH',
					tags: ['patterns', 'search'],
					userId: 'user-1',
					success: true,
					metadata: { query: 'design patterns' },
					sessionId: 'session-1',
				}),
			];

			// Record test entries
			for (const entry of testEntries) {
				await service.recordOperation(entry);
			}
		});

		it('should retrieve all history without filters', async () => {
			const history = await service.getHistory({});
			expect(history).toHaveLength(3);
		});

		it('should filter by project ID', async () => {
			const history = await service.getByProjectId('project-1');
			expect(history).toHaveLength(2);
			expect(history.every(entry => entry.projectId === 'project-1')).toBe(true);
		});

		it('should filter by user ID', async () => {
			const history = await service.getByUserId('user-1');
			expect(history).toHaveLength(2);
			expect(history.every(entry => entry.userId === 'user-1')).toBe(true);
		});

		it('should filter by tags', async () => {
			const history = await service.getByTags(['react']);
			expect(history).toHaveLength(1);
			expect(history[0]?.tags).toContain('react');
		});

		it('should filter by operation type', async () => {
			const filters: HistoryFilters = { operation: 'ADD' };
			const history = await service.getHistory(filters);
			expect(history).toHaveLength(1);
			expect(history[0]?.operation).toBe('ADD');
		});

		it('should filter by multiple operation types', async () => {
			const filters: HistoryFilters = { operation: ['ADD', 'SEARCH'] };
			const history = await service.getHistory(filters);
			expect(history).toHaveLength(2);
			expect(history.every(entry => ['ADD', 'SEARCH'].includes(entry.operation))).toBe(true);
		});

		it('should filter by success status', async () => {
			const filters: HistoryFilters = { success: false };
			const history = await service.getHistory(filters);
			expect(history).toHaveLength(1);
			expect(history[0]?.success).toBe(false);
		});

		it('should apply pagination', async () => {
			const filters: HistoryFilters = {
				options: { limit: 2, offset: 1 },
			};
			const history = await service.getHistory(filters);
			expect(history).toHaveLength(2);
		});

		it('should sort results', async () => {
			const filters: HistoryFilters = {
				options: { sortBy: 'name', sortOrder: 'asc' },
			};
			const history = await service.getHistory(filters);
			expect(history[0]?.name).toBe('Add React knowledge');
		});

		it('should throw error when not connected', async () => {
			await service.disconnect();
			await expect(service.getHistory({})).rejects.toThrow('not connected');
		});
	});

	describe('Analytics', () => {
		beforeEach(async () => {
			await service.connect();

			// Create test entries for analytics
			const entries = [
				createMemoryHistoryEntry({
					projectId: 'project-1',
					memoryId: 'mem-1',
					name: 'Operation 1',
					operation: 'ADD',
					tags: ['react', 'javascript'],
					success: true,
					duration: 100,
					metadata: {},
				}),
				createMemoryHistoryEntry({
					projectId: 'project-1',
					memoryId: 'mem-2',
					name: 'Operation 2',
					operation: 'ADD',
					tags: ['react', 'hooks'],
					success: false,
					duration: 200,
					metadata: {},
				}),
				createMemoryHistoryEntry({
					projectId: 'project-2',
					memoryId: 'mem-3',
					name: 'Operation 3',
					operation: 'SEARCH',
					tags: ['python'],
					success: true,
					duration: 150,
					metadata: {},
				}),
			];

			for (const entry of entries) {
				await service.recordOperation(entry);
			}
		});

		it('should calculate operation statistics', async () => {
			const stats = await service.getOperationStats();

			expect(stats.totalOperations).toBe(3);
			expect(stats.successCount).toBe(2);
			expect(stats.errorCount).toBe(1);
			expect(stats.operationCounts.ADD).toBe(2);
			expect(stats.operationCounts.SEARCH).toBe(1);
			expect(stats.averageDuration).toBe(150);
			expect(stats.topTags).toContainEqual({ tag: 'react', count: 2 });
		});

		it('should filter statistics by project', async () => {
			const stats = await service.getOperationStats('project-1');

			expect(stats.totalOperations).toBe(2);
			expect(stats.operationCounts.ADD).toBe(2);
			expect(stats.operationCounts.SEARCH).toBe(0);
		});

		it('should calculate success rate', async () => {
			const successRate = await service.getSuccessRate();
			expect(successRate).toBeCloseTo(2 / 3, 2);
		});

		it('should return 0 success rate for no operations', async () => {
			const successRate = await service.getSuccessRate('nonexistent-project');
			expect(successRate).toBe(0);
		});

		it('should throw error when not connected', async () => {
			await service.disconnect();
			await expect(service.getOperationStats()).rejects.toThrow('not connected');
		});
	});

	describe('Helper Functions', () => {
		it('should create memory history entry with defaults', () => {
			const entry = createMemoryHistoryEntry({
				projectId: 'test-project',
				memoryId: 'mem-123',
				name: 'Test operation',
				operation: 'ADD',
				tags: ['test'],
				success: true,
				metadata: {},
			});

			expect(entry.id).toBeDefined();
			expect(entry.timestamp).toBeDefined();
			expect(entry.projectId).toBe('test-project');
			expect(Date.parse(entry.timestamp)).not.toBeNaN();
		});

		it('should use provided ID and timestamp', () => {
			const customId = 'custom-id';
			const customTimestamp = '2023-01-01T00:00:00.000Z';

			const entry = createMemoryHistoryEntry({
				id: customId,
				timestamp: customTimestamp,
				projectId: 'test-project',
				memoryId: 'mem-123',
				name: 'Test operation',
				operation: 'ADD',
				tags: ['test'],
				success: true,
				metadata: {},
			});

			expect(entry.id).toBe(customId);
			expect(entry.timestamp).toBe(customTimestamp);
		});
	});
});
