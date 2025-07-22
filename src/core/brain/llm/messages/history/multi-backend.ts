import { IConversationHistoryProvider } from './types.js';
import { InternalMessage } from '../types.js';
import { WALHistoryProvider } from './wal.js';

export class MultiBackendHistoryProvider implements IConversationHistoryProvider {
	private walFlushInterval: NodeJS.Timeout | null = null;

	constructor(
		private primary: IConversationHistoryProvider,
		private backup: IConversationHistoryProvider,
		private wal: WALHistoryProvider,
		private flushIntervalMs: number = 5000 // configurable
	) {
		this.startWALFlushWorker();
	}

	async getHistory(sessionId: string, limit?: number): Promise<InternalMessage[]> {
		try {
			return await this.primary.getHistory(sessionId, limit);
		} catch (err) {
			console.error('[MultiBackend] Primary getHistory failed, falling back to backup:', err);
			return await this.backup.getHistory(sessionId, limit);
		}
	}

	async saveMessage(sessionId: string, message: InternalMessage): Promise<void> {
		try {
			await this.primary.saveMessage(sessionId, message);
		} catch (err) {
			console.error('[MultiBackend] Primary saveMessage failed:', err);
			throw err; // Do not proceed if primary fails
		}
		try {
			await this.wal.saveMessage(sessionId, message);
		} catch (err) {
			console.error('[MultiBackend] WAL saveMessage failed:', err);
			throw err; // WAL is critical for durability
		}
		// WAL will be flushed to backup asynchronously
	}

	async clearHistory(sessionId: string): Promise<void> {
		try {
			await this.primary.clearHistory(sessionId);
		} catch (err) {
			console.error('[MultiBackend] Primary clearHistory failed:', err);
		}
		try {
			await this.backup.clearHistory(sessionId);
		} catch (err) {
			console.error('[MultiBackend] Backup clearHistory failed:', err);
		}
		try {
			await this.wal.clearHistory(sessionId);
		} catch (err) {
			console.error('[MultiBackend] WAL clearHistory failed:', err);
		}
	}

	private startWALFlushWorker() {
		if (this.walFlushInterval) return;
		this.walFlushInterval = setInterval(async () => {
			try {
				const pending = await this.wal.getPendingEntries();
				for (const { sessionId, message } of pending) {
					try {
						await this.backup.saveMessage(sessionId, message);
						await this.wal.markFlushed(sessionId, message);
					} catch (err) {
						console.error('[MultiBackend] Backup saveMessage failed during WAL flush:', err);
						// Do not mark as flushed, will retry
					}
				}
			} catch (err) {
				console.error('[MultiBackend] WAL flush worker error:', err);
			}
		}, this.flushIntervalMs);
	}

	async disconnect() {
		if (this.walFlushInterval) {
			clearInterval(this.walFlushInterval);
			this.walFlushInterval = null;
		}
		if (typeof (this.primary as any).disconnect === 'function') {
			await (this.primary as any).disconnect();
		}
		if (typeof (this.backup as any).disconnect === 'function') {
			await (this.backup as any).disconnect();
		}
		if (typeof (this.wal as any).disconnect === 'function') {
			await (this.wal as any).disconnect();
		}
	}
}
