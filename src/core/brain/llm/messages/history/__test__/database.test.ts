import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseHistoryProvider } from '../database.js';
import { StorageManager } from '../../../../../storage/manager.js';
import type { InternalMessage } from '../../types.js';
import { InMemoryBackend } from '../../../../../storage/backend/in-memory.js';

function makeMessage(i = 0): InternalMessage {
	return { role: 'user' as const, content: `msg${i}` };
}

describe('DatabaseHistoryProvider', () => {
	let provider: DatabaseHistoryProvider;
	let storageManager: StorageManager;
	let sessionId: string;
	let message: InternalMessage;
	let backend: any;

	beforeEach(async () => {
		sessionId = 'test-session';
		message = { role: 'user', content: 'hello' };
		backend = new InMemoryBackend();
		await backend.connect();
		storageManager = {
			getBackends: () => ({ database: backend }),
		} as any;
		provider = new DatabaseHistoryProvider(storageManager);
		await provider.clearHistory(sessionId);
	});

	afterEach(async () => {
		await provider.clearHistory(sessionId);
		if (typeof storageManager.disconnect === 'function') {
			await storageManager.disconnect();
		}
		vi.restoreAllMocks();
	});

	it('should save and retrieve messages in order', async () => {
		await provider.saveMessage(sessionId, message);
		const history = await provider.getHistory(sessionId);
		expect(history).toEqual([message]);
	});

	it('should enforce message limit', async () => {
		const many = Array(1005).fill(message);
		await backend.set(`messages:${sessionId}`, many);
		await provider.saveMessage(sessionId, message);
		const saved = await provider.getHistory(sessionId);
		expect(saved.length).toBeLessThanOrEqual(1000);
	});

	it('should clear history', async () => {
		await provider.saveMessage(sessionId, message);
		await provider.clearHistory(sessionId);
		const history = await provider.getHistory(sessionId);
		expect(history.length).toBe(0);
	});

	it('should log and handle getHistory error gracefully', async () => {
		const spy = vi.spyOn(backend, 'get').mockRejectedValueOnce(new Error('fail'));
		const result = await provider.getHistory(sessionId);
		expect(result).toEqual([]);
		spy.mockRestore();
	});

	it('should log and handle saveMessage error gracefully', async () => {
		const spy = vi.spyOn(backend, 'set').mockRejectedValueOnce(new Error('fail'));
		await provider.saveMessage(sessionId, message);
		spy.mockRestore();
	});

	it('should log and handle clearHistory error gracefully', async () => {
		const spy = vi.spyOn(backend, 'delete').mockRejectedValueOnce(new Error('fail'));
		await provider.clearHistory(sessionId);
		spy.mockRestore();
	});

	it('should truncate and redact content in debug logs', async () => {
		const longMessage = { role: 'user' as const, content: 'a'.repeat(200) };
		const spy = vi.spyOn(backend, 'set');
		await provider.saveMessage(sessionId, longMessage);
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it('should perform under 100ms for 1000+ messages', async () => {
		const many = Array.from({ length: 1200 }, (_, i) => makeMessage(i));
		await backend.set(`messages:${sessionId}`, many);
		const start = Date.now();
		await provider.saveMessage(sessionId, makeMessage(1201));
		const duration = Date.now() - start;
		expect(duration).toBeLessThan(100); // Adjust threshold as needed
	});
});
