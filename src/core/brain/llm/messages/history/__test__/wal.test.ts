import { describe, it, expect, beforeEach } from 'vitest';
import { WALHistoryProvider } from '../wal.js';
import type { InternalMessage } from '../../types.js';

function makeMessage(content: string): InternalMessage {
	return { role: 'user', content };
}

describe('WALHistoryProvider', () => {
	let wal: WALHistoryProvider;
	let sessionId: string;

	beforeEach(() => {
		sessionId = 'wal-session';
		wal = new WALHistoryProvider();
	});

	it('appends and retrieves messages', async () => {
		await wal.saveMessage(sessionId, makeMessage('a'));
		await wal.saveMessage(sessionId, makeMessage('b'));
		const history = await wal.getHistory(sessionId);
		expect(history.length).toBe(2);
		expect(history[0]).toBeDefined();
		expect(history[0]?.content).toBe('a');
		expect(history[1]).toBeDefined();
		expect(history[1]?.content).toBe('b');
	});

	it('returns only unflushed entries as pending', async () => {
		const msgA = makeMessage('a');
		const msgB = makeMessage('b');
		await wal.saveMessage(sessionId, msgA);
		await wal.saveMessage(sessionId, msgB);
		let pending = await wal.getPendingEntries();
		expect(pending.length).toBe(2);
		await wal.markFlushed(sessionId, msgA);
		pending = await wal.getPendingEntries();
		expect(pending.length).toBe(1);
		expect(pending[0]).toBeDefined();
		expect(pending[0]?.message.content).toBe('b');
	});

	it('clears history for a session', async () => {
		await wal.saveMessage(sessionId, makeMessage('a'));
		await wal.saveMessage('other', makeMessage('b'));
		await wal.clearHistory(sessionId);
		const history = await wal.getHistory(sessionId);
		expect(history.length).toBe(0);
		const other = await wal.getHistory('other');
		expect(other.length).toBe(1);
	});
});
