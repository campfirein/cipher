import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MultiBackendHistoryProvider } from '../multi-backend.js';
import { WALHistoryProvider } from '../wal.js';
import type { IConversationHistoryProvider } from '../types.js';
import type { InternalMessage } from '../../types.js';

function makeMessage(content: string): InternalMessage {
	return { role: 'user', content };
}

describe('MultiBackendHistoryProvider', () => {
	let primary: IConversationHistoryProvider;
	let backup: IConversationHistoryProvider;
	let wal: WALHistoryProvider;
	let provider: MultiBackendHistoryProvider;
	let sessionId: string;

	beforeEach(() => {
		sessionId = 'test-session';
		wal = new WALHistoryProvider();
		primary = {
			getHistory: vi.fn(async () => []),
			saveMessage: vi.fn(async () => {}),
			clearHistory: vi.fn(async () => {}),
		};
		backup = {
			getHistory: vi.fn(async () => []),
			saveMessage: vi.fn(async () => {}),
			clearHistory: vi.fn(async () => {}),
		};
		provider = new MultiBackendHistoryProvider(primary, backup, wal, 100);
	});

	it('writes to primary and WAL synchronously', async () => {
		const msg = makeMessage('hello');
		await provider.saveMessage(sessionId, msg);
		expect((primary.saveMessage as any).mock.calls.length).toBe(1);
		expect(wal.getHistory(sessionId).then(h => h.length)).resolves.toBe(1);
	});

	it('throws if primary write fails', async () => {
		(primary.saveMessage as any).mockRejectedValueOnce(new Error('fail'));
		await expect(provider.saveMessage(sessionId, makeMessage('fail'))).rejects.toThrow('fail');
	});

	it('throws if WAL write fails', async () => {
		wal.saveMessage = vi.fn(async () => {
			throw new Error('wal fail');
		});
		await expect(provider.saveMessage(sessionId, makeMessage('fail'))).rejects.toThrow('wal fail');
	});

	it('flushes WAL to backup asynchronously', async () => {
		const msg = makeMessage('to-backup');
		await provider.saveMessage(sessionId, msg);
		// Simulate WAL flush interval
		await new Promise(res => setTimeout(res, 200));
		expect((backup.saveMessage as any).mock.calls.length).toBeGreaterThan(0);
	});

	it('retries backup write if it fails', async () => {
		const msg = makeMessage('retry');
		let fail = true;
		backup.saveMessage = vi.fn(async () => {
			if (fail) {
				fail = false;
				throw new Error('fail');
			}
		});
		await provider.saveMessage(sessionId, msg);
		await new Promise(res => setTimeout(res, 300));
		expect((backup.saveMessage as any).mock.calls.length).toBeGreaterThan(1);
	});

	it('getHistory falls back to backup if primary fails', async () => {
		(primary.getHistory as any).mockRejectedValueOnce(new Error('fail'));
		(backup.getHistory as any).mockResolvedValueOnce([makeMessage('backup')]);
		const result = await provider.getHistory(sessionId);
		expect(result[0]).toBeDefined();
		expect(result[0]?.content).toBe('backup');
	});
});
