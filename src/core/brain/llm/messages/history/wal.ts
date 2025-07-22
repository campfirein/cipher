import { IConversationHistoryProvider } from './types.js';
import { InternalMessage } from '../types.js';

interface WALEntry {
	sessionId: string;
	message: InternalMessage;
	flushed: boolean;
}

export class WALHistoryProvider implements IConversationHistoryProvider {
	private log: WALEntry[] = [];

	async getHistory(sessionId: string, limit?: number): Promise<InternalMessage[]> {
		// Return all messages for a session (not used for main reads)
		return this.log.filter(e => e.sessionId === sessionId).map(e => e.message);
	}

	async saveMessage(sessionId: string, message: InternalMessage): Promise<void> {
		this.log.push({ sessionId, message, flushed: false });
	}

	async clearHistory(sessionId: string): Promise<void> {
		this.log = this.log.filter(e => e.sessionId !== sessionId);
	}

	async getPendingEntries(): Promise<{ sessionId: string; message: InternalMessage }[]> {
		return this.log
			.filter(e => !e.flushed)
			.map(e => ({ sessionId: e.sessionId, message: e.message }));
	}

	async markFlushed(sessionId: string, message: InternalMessage): Promise<void> {
		const entry = this.log.find(
			e => e.sessionId === sessionId && e.message === message && !e.flushed
		);
		if (entry) entry.flushed = true;
	}

	async disconnect() {
		// No-op for in-memory WAL
	}
}
