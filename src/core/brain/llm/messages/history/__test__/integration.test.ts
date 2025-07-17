import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseHistoryProvider } from '../database.js';
import { StorageManager } from '../../../../../storage/manager.js';
import type { InternalMessage } from '../../types.js';

const mockLogger = { error: () => {}, warn: () => {}, debug: () => {} };

const storageConfigs = [
	{
		name: 'in-memory',
		config: { cache: { type: 'in-memory' as const }, database: { type: 'in-memory' as const } },
	},
	// Add SQLite and PostgreSQL configs if available in your environment
	// { name: 'sqlite', config: { cache: { type: 'in-memory' as const }, database: { type: 'sqlite', path: ':memory:' } } },
	// { name: 'postgres', config: { cache: { type: 'in-memory' as const }, database: { type: 'postgres', url: 'postgres://user:pass@localhost:5432/testdb' } } },
];

describe.each(storageConfigs)('DatabaseHistoryProvider integration ($name)', ({ config }) => {
	let provider: DatabaseHistoryProvider;
	let sessionId: string;
	let message: InternalMessage;
	let storageManager: StorageManager;

	beforeEach(async () => {
		sessionId = 'integration-session';
		message = { role: 'user', content: 'integration test' };
		storageManager = new StorageManager(config);
		await storageManager.connect();
		provider = new DatabaseHistoryProvider(storageManager);
		await provider.clearHistory(sessionId);
	});

	afterEach(async () => {
		await provider.clearHistory(sessionId);
		await storageManager.disconnect();
	});

	it('should save and retrieve messages with real storage', async () => {
		await provider.saveMessage(sessionId, message);
		const history = await provider.getHistory(sessionId);
		expect(history.length).toBeGreaterThan(0);
		expect(history[history.length - 1]).toEqual(message);
	});

	it('should clear history with real storage', async () => {
		await provider.saveMessage(sessionId, message);
		await provider.clearHistory(sessionId);
		const history = await provider.getHistory(sessionId);
		expect(history.length).toBe(0);
	});

	it('should isolate histories between sessions', async () => {
		const session2 = 'other-session';
		await provider.saveMessage(sessionId, { role: 'user', content: 'A' });
		await provider.saveMessage(session2, { role: 'user', content: 'B' });
		const h1 = await provider.getHistory(sessionId);
		const h2 = await provider.getHistory(session2);
		expect(h1.map(m => m.content)).toContain('A');
		expect(h2.map(m => m.content)).toContain('B');
		expect(h1.map(m => m.content)).not.toContain('B');
		expect(h2.map(m => m.content)).not.toContain('A');
	});

	it('should persist history across provider re-instantiation', async () => {
		await provider.saveMessage(sessionId, { role: 'user', content: 'persisted' });
		// Re-instantiate provider
		const provider2 = new DatabaseHistoryProvider(storageManager);
		const history = await provider2.getHistory(sessionId);
		expect(history.map(m => m.content)).toContain('persisted');
	});

	it('should handle migration from legacy/empty data', async () => {
		// Simulate legacy data (empty array or missing key)
		await provider.clearHistory(sessionId);
		const history = await provider.getHistory(sessionId);
		expect(Array.isArray(history)).toBe(true);
		expect(history.length).toBe(0);
	});
});
